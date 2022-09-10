import { runBundler, showStackTraces } from './runBundler'

void runBundler(process.argv)
  .catch(e => {
    console.error('Aborted:', showStackTraces ? e : e.message)
    process.exit(1)
  })
