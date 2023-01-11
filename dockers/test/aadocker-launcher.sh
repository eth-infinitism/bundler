#!/bin/bash
cd `dirname $0`
case $1 in

 start)
	docker-compose up -d
	while ! [[  `curl 2>/dev/null  -X POST http://localhost:3000/rpc` =~ error ]]; do sleep 1 ; done
	;;
 stop)
 	docker-compose down
	;;

 *)
	echo "usage: $0 {start|stop}"
esac
