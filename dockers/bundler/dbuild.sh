#!/bin/bash -e
cd `cd \`dirname $0\`;pwd`

#need to preprocess first to have the Version.js
yarn preprocess

test -z "$VERSION" && VERSION=`node -e "console.log(require('../../packages/common/dist/src/Version.js').erc4337RuntimeVersion)"`
echo version=$VERSION

IMAGE=alexforshtat/erc4337bundler

#build docker image of bundler
#rebuild if there is a newer src file:
find ./dbuild.sh ../../packages/*/src/ -type f -newer dist/bundler.js 2>&1 | grep . && {
	npx webpack
}

docker build -t $IMAGE .
docker tag $IMAGE $IMAGE:$VERSION
echo "== To publish"
echo "   docker push $IMAGE:latest; docker push $IMAGE:$VERSION"

