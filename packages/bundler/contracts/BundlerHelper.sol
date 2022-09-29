// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.15;

import "@account-abstraction/contracts/core/EntryPoint.sol";
import "solidity-string-utils/StringUtils.sol";

contract BundlerHelper {
    using StringUtils for *;

    /**
     * run handleop. require to get refund for the used gas.
     */
    function handleOps(uint expectedPaymentGas, EntryPoint ep, UserOperation[] calldata ops, address payable beneficiary)
    public returns (uint paid, uint gasPrice, bytes memory errorReason){
        gasPrice = tx.gasprice;
        uint expectedPayment = expectedPaymentGas * gasPrice;
        uint preBalance = beneficiary.balance;
        try ep.handleOps(ops, beneficiary) {
        } catch (bytes memory err) {
            errorReason = err;
        }
        paid = beneficiary.balance - preBalance;
        if (paid < expectedPayment) {
            revert(string.concat(
                "didn't pay enough: paid ", paid.toString(),
                " expected ", expectedPayment.toString(),
                " gasPrice ", gasPrice.toString()
            ));
        }
    }
}
