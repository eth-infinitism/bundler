// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.15;


contract Config {

    uint public immutable val;
    constructor(ConfigFactory f) {
        try f.val() returns (uint _val) {
            val = _val;
        } catch {
//            val = 0;
        }
    }
    function destruct() public {
        selfdestruct(payable(msg.sender));
    }
}

contract ConfigFactory {
    uint public val;
    Config public cfg = new Config{salt : 0}(this);

    //return config object: always on the same address, but with different code..
    function getConfig(uint _val) public returns (Config){
        cfg.destruct();
        val = _val;
        return new Config{salt : 0}(this);
    }
}

contract BundlerHelper {
    function getCodeHashes(address[] memory addresses) public view returns (bytes32) {
        bytes32[] memory hashes = new bytes32[](addresses.length);
        for (uint i = 0; i < addresses.length; i++) {
            hashes[i] = addresses[i].codehash;
        }
        bytes memory data = abi.encode(hashes);
        return keccak256(data);
    }
}
