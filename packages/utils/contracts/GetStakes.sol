pragma solidity >=0.8;
// SPDX-License-Identifier: GPL-3.0

import "@account-abstraction/contracts/interfaces/IEntryPoint.sol";

    struct StakeInfo {
        address addr;
        uint256 stake;
        uint256 unstakeDelaySec;
    }

    error StakesRet(StakeInfo[] stakes);

// helper: get stake info of multiple entities.
// This contract is never deployed: it is called using eth_call, and it reverts with the result...
contract GetStakes {

    constructor(IEntryPoint entryPoint, address[] memory addrs) {
        StakeInfo[] memory stakes = getStakes(entryPoint, addrs);
        revert StakesRet(stakes);
    }

    function getStakes(IEntryPoint entryPoint, address[] memory addrs) public view returns (StakeInfo[] memory) {
        StakeInfo[] memory stakes = new StakeInfo[](addrs.length);
        for (uint256 i = 0; i < addrs.length; i++) {
            IStakeManager.DepositInfo memory info = entryPoint.getDepositInfo(addrs[i]);
            stakes[i] = StakeInfo(addrs[i], info.stake, info.unstakeDelaySec);
        }
        return stakes;
    }
}
