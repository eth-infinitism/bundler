# SDK to check if the validation code of a UserOperation violates any validation rules

## Usage

In order to check the `UserOperation` you have created, use the code below.

This is especially useful if you are developing a custom `Account` or `Paymaster` contract,
overriding the `validateUserOp`, `validatePaymasterUserOp`, or expect your contracts' code to
be called from these methods within the ERC-4337 transaction context.

```typescript
import { UserOperation } from '@account-abstraction/utils'
import { checkRulesViolations } from '@account-abstraction/validation-manager'

const userOperation: UserOperation = createUserOp()
await checkRulesViolations(provider, userOperation, entryPoint)
```
