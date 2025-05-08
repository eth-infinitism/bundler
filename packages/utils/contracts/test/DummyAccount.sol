pragma solidity ^0.8.0;
//SPDX-License-Identifier: GPL-3.0-only

import "@account-abstraction/contracts/core/BaseAccount.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

// dummy erc-4337 account
// ignores everything, just for testing handleOps
contract DummyAccount is BaseAccount {

    IEntryPoint immutable theEntryPoint;
    constructor(IEntryPoint _entryPoint) {
        theEntryPoint = _entryPoint;
    }

    function entryPoint() public view override returns (IEntryPoint) {
        return theEntryPoint;
    }

    //no signature check
    function _validateSignature(PackedUserOperation calldata, bytes32)
    internal pure override returns (uint256 validationData) {
        return 0;
    }
}

contract DummyAccountFactory {

    DummyAccount public immutable theAccount;
    constructor(IEntryPoint _entryPoint) {
        theAccount = new DummyAccount(_entryPoint);
    }
    //this is not a fully-functional factory: it doesn't return the address if the account already exists
    function createAccount(uint256 salt) external returns (address) {
        return address(new ERC1967Proxy(address(theAccount), ""));
    }
}
