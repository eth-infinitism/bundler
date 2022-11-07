// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.15;

// import "@account-abstraction/contracts/core/EntryPoint.sol";
// import "solidity-string-utils/StringUtils.sol";

contract TracerTest {

    uint public a;
    uint public b = 20;
    mapping(address=>uint) public addr2int;

    function testKeccak(bytes memory asd) public payable returns (bytes32 ret) {
        ret = keccak256(asd);
        emit Keccak(ret);
    }

    event Keccak(bytes32 data);

    function revertWithMessage(bool oog) external {
        while (oog) {
            emit Keccak(bytes32(0));
        }
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
        this.revertWithMessage(oog);
    }
}

