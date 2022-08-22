//SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

// TODO: get hardhat types from '@account-abstraction' and '@erc43337/common' package directly
// only to import the file in hardhat compilation
import "@erc4337/common/contracts/test/SampleRecipient.sol";
import "@erc4337/common/contracts/test/SingletonFactory.sol";

contract Import {
    SampleRecipient sampleRecipient;
    SingletonFactory singletonFactory;
}
