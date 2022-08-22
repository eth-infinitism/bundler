/**
 * SPDX-License-Identifier:MIT
 */
pragma solidity ^0.8.6;

import "@openzeppelin/contracts/access/Ownable.sol";

contract CaptureTheFlag is Ownable {

    event FlagCaptured(address previousHolder, address currentHolder);

    address public currentHolder = address(0);

    function captureTheFlag() external {
        address previousHolder = currentHolder;

        currentHolder = msg.sender;

        emit FlagCaptured(previousHolder, currentHolder);
    }
}
