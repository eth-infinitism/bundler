import { UserOperationStruct } from '@account-abstraction/contracts'
import { BigNumberish } from 'ethers';

export interface AdvancedUserOperationStruct extends UserOperationStruct {
    advancedUserOperation?: AdvancedUserOperations

}

export class AdvancedUserOperations {

    executionTimeWindow?: ExecutionTimeWindow
    executionConditions?: Array<ExecutionCondition>
}
export class ExecutionTimeWindow {
    executionWindowStart!: BigNumberish;
    executionWindowEnd!: BigNumberish;
}
export class ExecutionCondition {
    contract!: string;
    eventSignature!: string;
    eventLogHash!: string;

}