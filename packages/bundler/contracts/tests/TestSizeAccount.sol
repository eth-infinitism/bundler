import "@account-abstraction/contracts/interfaces/IAccount.sol";
import "@account-abstraction/contracts/interfaces/IPaymaster.sol";
import "@account-abstraction/contracts/interfaces/IEntryPoint.sol";
import "@openzeppelin/contracts/utils/Strings.sol";

contract EpWrapper {

    //helper to call entryPoint, and return used gas
    // - validate target contract was called (has the "called" counter modified
    function callEp(IEntryPoint ep, UserOperation memory op) public returns (uint) {
        UserOperation[] memory ops = new UserOperation[](1);
        ops[0] = op;
        TestSizeAccount account = TestSizeAccount(op.sender);
        uint pre = account.called();
        address payable beneficiary = payable(msg.sender);
        uint preBalance = beneficiary.balance;
        ep.handleOps(ops, beneficiary);
        uint post = account.called();
        require(pre != post, "failed to call account");
        uint postBalance = beneficiary.balance;
        return (postBalance - preBalance)/tx.gasprice;
    }
}

contract TestSizeAccount is IAccount {
    uint public called;

    function validateUserOp(UserOperation calldata userOp, bytes32 userOpHash, address aggregator, uint256 missingAccountFunds)
    external override returns (uint256 deadline) {
        if (missingAccountFunds > 0) {
            (bool success,) = msg.sender.call{value : missingAccountFunds}("");
            (success);
        }
        return 0;
    }

    //accept any calldata
    fallback() external {
        called ++;
    }
}

contract TestSizeFactory {
    function deploy(uint salt, bytes memory data) public returns (TestSizeAccount) {
        TestSizeAccount acct = new TestSizeAccount{salt : bytes32(salt)}();
        return acct;
    }
}

//test paymaster.
// use nonce as returned context size (our test account is known to ignore the nonce..)
contract TestSizePaymaster is IPaymaster {
    function validatePaymasterUserOp(UserOperation calldata userOp, bytes32 userOpHash, uint256 maxCost)
    external override returns (bytes memory context, uint256 deadline) {

        context = new bytes(userOp.nonce);
        deadline = 0;
    }

    function postOp(PostOpMode mode, bytes calldata context, uint256 actualGasCost) external override {
    }

}
