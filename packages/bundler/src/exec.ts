import { runBundler } from './runBundler'

runBundler(process.argv)
  .catch(e => {
    console.log(e)
    process.exit(1)
  })
