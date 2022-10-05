//SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

// TODO: get hardhat types from '@account-abstraction' package directly
// only to import the file in hardhat compilation
import "@account-abstraction/contracts/samples/SimpleWallet.sol";

contract SampleRecipient {

    SimpleWallet wallet;

    event Sender(address txOrigin, address msgSender, string message);

    function something(string memory message) public {
        emit Sender(tx.origin, msg.sender, message);
    }

    // solhint-disable-next-line
    function reverting() public {
        revert( "test revert");
    }
}
