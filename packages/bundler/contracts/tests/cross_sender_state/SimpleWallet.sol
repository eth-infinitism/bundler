// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.12;

import "@account-abstraction/contracts/interfaces/IAccount.sol";
import "@account-abstraction/contracts/interfaces/IEntryPoint.sol";
import "./State.sol";

contract SimpleWallet is IAccount {

    address ep;
    uint256 public state;

    constructor(address _ep) payable {
        ep = _ep;
        (bool req,) = address(ep).call{value : msg.value}("");
        require(req);
    }

    function addStake(IEntryPoint _ep, uint32 delay) public payable {
        _ep.addStake{value: msg.value}(delay);
    }

    function setState(uint _state) external {
        state=_state;
    }

    function fail() external {
        revert("test fail");
    }

    function validateUserOp(UserOperation calldata userOp, bytes32, uint256 missingWalletFunds)
    public override virtual returns (uint256 validationData) {
        if (userOp.callData.length == 20) {
            State(address(bytes20(userOp.callData))).getState(address(this));
        }

        if (missingWalletFunds>0) {
            msg.sender.call{value:missingWalletFunds}("");
        }
        bytes2 sig = bytes2(userOp.signature);
        require(sig != 0xdead, "testWallet: dead signature");
        return sig == 0xdeaf ? 1 : 0;
    }
}
