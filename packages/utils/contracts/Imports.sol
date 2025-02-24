// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8;

import "@account-abstraction/contracts/core/EntryPointSimulations.sol";
import "@account-abstraction/contracts/interfaces/IStakeManager.sol";
import "@account-abstraction/contracts/accounts/SimpleAccountFactory.sol";
import "@account-abstraction/rip7560/contracts/predeploys/Rip7560StakeManager.sol";
import "@account-abstraction/rip7560/contracts/interfaces/IRip7560Account.sol";
import "@account-abstraction/rip7560/contracts/interfaces/IRip7560Paymaster.sol";

import {NonceManager as NonceManagerRIP7712} from "@account-abstraction/rip7560/contracts/predeploys/NonceManager.sol";
