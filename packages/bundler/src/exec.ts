import { runBundler, showStackTraces } from './runBundler'

runBundler(process.argv)
  // .catch(e => {
  //   console.error('Aborted:', e.message)
  //   process.exit(1)
  // })
