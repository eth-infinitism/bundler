// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.15;

// import "@account-abstraction/contracts/core/EntryPoint.sol";
// import "solidity-string-utils/StringUtils.sol";

contract TracerTest {

    uint public a;
    uint public b = 20;
    mapping(address => uint) public addr2int;

    event ExecSelfResult(bytes data, bool success, bytes result);

    function execSelf(bytes calldata data, bool useNumber) external returns (uint){
        uint b;
        if (useNumber) {
            b = block.number;
        }
        (bool success, bytes memory result) = address(this).call(data);
        if (useNumber) {
            b += block.number;
        }
        emit ExecSelfResult(data, success, result);
        //not really needed, just avoid optimising out
        return b;
    }

    function doNothing() public {}

    function callTimeStamp() public returns (uint) {
        return block.timestamp;
    }

    function testKeccak(bytes memory asd) public payable returns (bytes32 ret) {
        ret = keccak256(asd);
        emit Keccak(asd, ret);
    }

    event Keccak(bytes input, bytes32 output);

    function revertWithMessage() external {
        revert ("revert message");
    }

    function testCallGas() public returns (uint) {
        return gasleft();
    }

    function callWithValue() external payable returns (uint){
        //write slot a
        a = 21;
        // manual run a keccak
        this.testKeccak{value : msg.value}("empty");
        // read slot b, write to  mapping
        addr2int[msg.sender] = b;
        return b;
    }

    function callRevertingFunction(bool oog) external payable {
        uint gas = gasleft();
        if (oog) {
            gas = 500;
            // not enough for log
        }
        this.revertWithMessage{gas : gas}();
    }

    event BeforeExecution();

    function testStopTracing() public {
        this.callTimeStamp();
        this.callTimeStamp();
        emit BeforeExecution();
        this.callTimeStamp();
    }
}

