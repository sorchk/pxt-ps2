//% color="#7BD239" weight=100 icon="\uf11b" block="PS2手柄"
namespace ps2ctl {
    export enum DigitalButton {
        //% block="选择"
        //% block.loc.zh = "选择"
        Select = 0x0001,
        //% block="L3"
        L3 = 0x0002,
        //% block="R3"
        R3 = 0x0004,
        //% block="开始"
        //% block.loc.zh = "开始"
        Start = 0x0008,
        //% block="上"
        //% block.loc.zh = "上"
        Up = 0x0010,
        //% block="右"
        //% block.loc.zh = "右"
        Right = 0x0020,
        //% block="下"
        //% block.loc.zh = "下"
        Down = 0x0040,
        //% block="左"
        //% block.loc.zh = "左"
        Left = 0x0080,
        //% block="L2"
        L2 = 0x0100,
        //% block="R2"
        R2 = 0x0200,
        //% block="L1"
        L1 = 0x0400,
        //% block="R1"
        R1 = 0x0800,
        //% block="△"
        //% block.loc.zh = "△"
        Triangle = 0x1000,
        //% block="○"
        //% block.loc.zh = "○"
        Circle = 0x2000,
        //% block="Ｘ"
        //% block.loc.zh = "Ｘ"
        Cross = 0x4000,
        //% block="□"
        //% block.loc.zh = "□"
        Square = 0x8000
    }
    //% blockId=AnalogButton
    export enum AnalogButton {
        //% block="右水平"
        //% block.loc.zh = "右水平"
        RX = 5,
        //% block="右垂直L"
        //% block.loc.zh = "右垂直"
        RY = 6,
        //% block="左水平L"
        //% block.loc.zh = "左水平"
        LX = 7,
        //% block="左垂直"
        //% block.loc.zh = "左垂直""
        LY = 8
    }

    let CS = 0, DO = 0, DI = 0, CLK = 0;
    let lastReadtime = 0;

    // Store read back data 
    let ps2Data = [0, 0, 0, 0, 0, 0, 0, 0, 0];
    let btData = 0;

    // Time control
    const CTRL_BYTE_DELAY = 5;
    let readDelay = 1;

    // Command list
    const ENTER_CONFIG = [0x01, 0x43, 0x00, 0x01, 0x00];
    const SET_ANALOGMODE = [0x01, 0x44, 0x00, 0x01, 0x03, 0x00, 0x00, 0x00, 0x00];
    const EXIT_CONFIG = [0x01, 0x43, 0x00, 0x00, 0x5A, 0x5A, 0x5A, 0x5A, 0x5A];
    const READ_DATA = [0x01, 0x42, 0, 0, 0, 0, 0, 0, 0];

    /**
     * Initialize ps2 controller and set pins, should run at first.
     * @param {DigitalPin} cs - CS pin name, eg: DigitalPin.P16
     * @param {DigitalPin} clk - CLK pin name, eg: DigitalPin.P13
     * @param {DigitalPin} dout - DO pin name, eg: DigitalPin.P15
     * @param {DigitalPin} din - DI pin name, eg: DigitalPin.P14
     * @return {number} 0 no error, 1 cannot communicat with wireless recreceiver, 2 cannot set wireless receiver mode
     */
    function initGamepad(cs: DigitalPin, clk: DigitalPin, din: DigitalPin, dout: DigitalPin): number {

        let temp = [0];

        // configure ports
        DO = dout;
        DI = din;
        CLK = clk;
        CS = cs;

        // set cs initial state
        pins.digitalWritePin(CS, 1);

        // configure spi
        pins.spiPins(DO, DI, CLK);
        pins.spiFormat(8, 3);
        pins.spiFrequency(500000);

        // new error checking. First, read gamepad a few times to see if it's talking
        readGamepad();
        readGamepad();
        //see if it talked - see if mode came back. 
        //If still anything but 41, 73 or 79, then it's not talking
        if (ps2Data[1] != 0x41 && ps2Data[1] != 0x73 && ps2Data[1] != 0x79) {
            return 1; //return error code 1
        }

        //try setting mode, increasing delays if need be.
        readDelay = 1;

        for (let y = 0; y <= 10; y++) {
            reconfigGamepad();
            readGamepad();

            if (ps2Data[1] == 0x73) {
                break;
            }

            if (y == 10) {
                return 2; //exit function with error
            }
            readDelay += 1; //add 1ms to readDelay
        }
        return 0; //no error if here
    }

    /**
     * table of function reverse 8-bit data
     * reverse data by check table
     */
    const rbits = hex`
    008040C020A060E0109050D030B070F0088848C828A868E8189858D838B878F8
    048444C424A464E4149454D434B474F40C8C4CCC2CAC6CEC1C9C5CDC3CBC7CFC
    028242C222A262E2129252D232B272F20A8A4ACA2AAA6AEA1A9A5ADA3ABA7AFA
    068646C626A666E6169656D636B676F60E8E4ECE2EAE6EEE1E9E5EDE3EBE7EFE
    018141C121A161E1119151D131B171F1098949C929A969E9199959D939B979F9
    058545C525A565E5159555D535B575F50D8D4DCD2DAD6DED1D9D5DDD3DBD7DFD
    038343C323A363E3139353D333B373F30B8B4BCB2BAB6BEB1B9B5BDB3BBB7BFB
    078747C727A767E7179757D737B777F70F8F4FCF2FAF6FEF1F9F5FDF3FBF7FFF`

    /**
     * reverse 8-bit data
     * @param {number} data - the data want to reverse.
     * @return {number} the reversed data
     * @note  The spi of ps2 is lsb, but spi of microbit is msb, and can not reconfig,
     * so we should transform the in/out data.
     */
    function rbit(value: number): number {
        return rbits[value] || 0x00;
    }

    /**
     * Send and recive data. 
     * @param {number} byte - the data to send , eg: 0x00
     * @return {number} back data
     */
    function inOutData(byte: number): number {
        return rbit(pins.spiWrite(rbit(byte)));
    }

    /**
     * Send and recive data. recive data is store in ps2Data and btData
     * @param {number} byte - the data to send , eg: 0x00
     * @return {number} 0 no error, 1 error
     */
    //% blockId=readGamepad block="读取PS2接收器数据"
    //% weight=99
    export function readGamepad(): boolean {

        let temp2 = input.runningTime() - lastReadtime;

        if (temp2 > 1500) {      //waited to long
            reconfigGamepad();
        }
        if (temp2 < readDelay) {  //waited too short
            control.waitMicros(readDelay - temp2);
        }

        // Try a few times to get valid data...
        for (let RetryCnt = 0; RetryCnt < 5; RetryCnt++) {
            pins.digitalWritePin(DO, 1);
            pins.digitalWritePin(CLK, 1);
            pins.digitalWritePin(CS, 0);    // low enable joystick

            control.waitMicros(CTRL_BYTE_DELAY);
            //Send the command to send button and joystick data;
            for (let i = 0; i < 9; i++) {
                ps2Data[i] = inOutData(READ_DATA[i]);
            }

            pins.digitalWritePin(CS, 1);    // high disable joystick

            // Check to see if we received valid data or not.  
            // We should be in analog mode for our data to be valid (analog == 0x7_)
            if ((ps2Data[1] & 0xf0) == 0x70) {
                break;
            }

            // If we got to here, we are not in analog mode, try to recover...
            reconfigGamepad(); // try to get back into Analog mode.
            control.waitMicros(readDelay);
        }

        // If we get here and still not in analog mode (=0x7_), try increasing the readDelay...
        if ((ps2Data[1] & 0xf0) != 0x70) {
            if (readDelay < 10)
                readDelay++;   // see if this helps out...
        }

        btData = ps2Data[3] + (ps2Data[4] << 8);   // store digital button value

        lastReadtime = input.runningTime();
        return ((ps2Data[1] & 0xf0) == 0x70);  // 1 = OK = analog mode - 0 = NOK
    }

    /**
     * Config gamepad set it in analog mode
     */
    function reconfigGamepad() {
        sendCommand(ENTER_CONFIG);
        sendCommand(SET_ANALOGMODE);
        sendCommand(EXIT_CONFIG);
    }

    /**
    * Send command
    * @param {number[]} cmd - the command array, eg: ENTER_CONFIG
    */
    function sendCommand(cmd: number[]) {
        pins.digitalWritePin(CS, 0);    // low enable joystick
        for (let y2 = 0; y2 < cmd.length; y2++) {
            inOutData(cmd[y2]);
        }
        pins.digitalWritePin(CS, 1);    // high disable joystick
        control.waitMicros(readDelay);     //wait a few
    }

    /**
     * return ps2 controller's digital button's state.
     * @param {DigitalButton} button - digital button name, eg: ps2.DigitalButton.Select
     * @return {boolean} digital button's state
     */
    //% blockId=calcPS2ButtonDigital block="由PS2数据计算数字按键 %button"
    //% weight=98
    export function buttonDigital(button: DigitalButton): boolean {
        return ((~btData & button) > 0);
    }

    /**
     * return ps2 controller's analog button's value.
     * @param {AnalogButton} button - analog button name, eg: ps2.AnalogButton.RX
     * @return {number} analog button's value, range: 0~255, idle: 128
     */
    //% blockId=calcPS2ButtonAnalog block="由PS2数据计算模拟摇杆 %button"
    //% weight=97
    //% block.loc.zh = ""
    export function buttonAnalog(button: AnalogButton): number {
        return ps2Data[button];
    }

    /**
     * Initialize ps2 controller and set pins, should run at first.
     */
    //% blockId=setPins block="设置PS2接收器引脚 din %dins dout %dout cs %cs clk %clk"
    //% din.defl=DigitalPin.P14
    //% dout.defl=DigitalPin.P15
    //% cs.defl=DigitalPin.P16
    //% clk.defl=DigitalPin.P13
    //% inlineInputMode=inline
    //% weight=100
    export function setPins(cs: DigitalPin, clk: DigitalPin, din: DigitalPin, dout: DigitalPin) {
        initGamepad(cs, clk, din, dout);
    }
    /**
     * read data from ps2 controller 
     */
    //% blockId=readPS2 block="读取PS2接收器数据"
    //% weight=99
    export function read() {
        readGamepad();
    }

}
