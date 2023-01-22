import "@account-abstraction/contracts/interfaces/IAccount.sol";
import "@account-abstraction/contracts/interfaces/IPaymaster.sol";
import "@account-abstraction/contracts/interfaces/IEntryPoint.sol";

contract EpWrapper {
    function callEp(IEntryPoint ep, UserOperation memory op) public returns (uint) {
        UserOperation[] memory ops = new UserOperation[](1);
        ops[0] = op;
        ep.handleOps(ops, payable(msg.sender));
        return TestSizeAccount(op.sender).called();
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
        return new TestSizeAccount{salt : bytes32(salt)}();
    }
}

contract TestSizePaymaster is IPaymaster {
    function validatePaymasterUserOp(UserOperation calldata userOp, bytes32 userOpHash, uint256 maxCost)
    external override returns (bytes memory context, uint256 deadline) {

        bytes memory rule = bytes(userOp.paymasterAndData[20 :]);
        if (keccak256(rule) == keccak256('ctx100'))
            context = new bytes(100);
        else if (keccak256(rule) == keccak256('ctx1k'))
            context = new bytes(10000);
        else if (keccak256(rule) == keccak256('ctx10k'))
            context = new bytes(10000);
        else if (keccak256(rule) != keccak256(""))
            revert(string.concat("unknown rule: ", string(rule)));
        deadline = 0;
    }

    function postOp(PostOpMode mode, bytes calldata context, uint256 actualGasCost) external override {
    }

}
