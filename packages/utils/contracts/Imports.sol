// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.23;

import "@account-abstraction/contracts/core/EntryPointSimulations.sol";
import "@account-abstraction/contracts/interfaces/IStakeManager.sol";
import "@account-abstraction/contracts/samples/SimpleAccountFactory.sol";
import "@account-abstraction/contracts/samples/TokenPaymaster.sol";

import {NonceManager as NonceManagerRIP7712} from "@account-abstraction/rip7560/contracts/predeploys/NonceManager.sol";
import {StakeManager as StakeManagerRIP7560} from "@account-abstraction/rip7560/contracts/predeploys/StakeManager.sol";
import {IStakeManager as IStakeManagerRIP7560} from "@account-abstraction/rip7560/contracts/interfaces/IStakeManager.sol";
