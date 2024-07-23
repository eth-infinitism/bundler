import { runBundler, showStackTraces } from './runBundler'

process.on('SIGINT', () => {
  process.exit(0)
})

process.on('SIGTERM', () => {
  process.exit(0)
})

void runBundler(process.argv).then((bundler) => {
  process.on('exit', () => {
    void bundler.stop()
  })
})
  .catch(e => {
    console.error('Aborted:', showStackTraces ? e : e.message)
    process.exit(1)
  })
