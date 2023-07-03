// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.12;

contract State {
    mapping(address => uint) state;

    function getState(address addr) public returns (uint) {
        return state[addr];
    }
}
