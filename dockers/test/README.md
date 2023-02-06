# Docker test environment

this docker-compose brings up a bundler, along with its supporting
node (geth)
It also deploys the entrypoint, and fund the signer account.

usage:

`aadocker-launcher.sh start`
   start the bundler (and node) in the background

`aadocker-launcher.sh stop`
   stop runnning docker images


can be used to launch a test (from bundler-spec-test) using

```
pdm run test --launcher-script=path/aadocker-launcher.sh
```
