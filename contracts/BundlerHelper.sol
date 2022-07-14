// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.15;

import "solidity-string-utils/StringUtils.sol";
import "@account-abstraction/contracts/EntryPoint.sol";

contract BundlerHelper {
    using StringUtils for *;

    /**
     * run handleop. require to get refund for the used gas.
     */
    function handleOps(uint expectedPaymentGas, EntryPoint ep, UserOperation[] calldata ops, address payable beneficiary)
    public returns (uint paid, uint gasPrice){
        gasPrice = tx.gasprice;
        uint expectedPayment = expectedPaymentGas * gasPrice;
        uint preBalance = beneficiary.balance;
        ep.handleOps(ops, beneficiary);
        paid = beneficiary.balance - preBalance;
        require(paid >= expectedPayment, string.concat(
                "didn't pay enough: paid ",
                paid.toString(),
                " gasPrice ", gasPrice.toString()
            ));
    }
}
