require( '../db.js' );
var hucUnits = require("../lib/hucUnits.js");
var BigNumber = require('bignumber.js');

var fs   = require('fs');

var Webu = require('webu');

var mongoose = require( 'mongoose' );
var Block     = mongoose.model( 'Block' );
var Transaction     = mongoose.model( 'Transaction' );

var grabBlocks = function(config) {
    var webu = new Webu(new Webu.providers.HttpProvider('http://112.74.96.198:' + config.ghucPort.toString()));


    if('listenOnly' in config && config.listenOnly === true) 
        listenBlocks(config, webu);
    else
        setTimeout(function() {
            grabBlock(config, webu, config.blocks.pop());
        }, 2000);

}

var listenBlocks = function(config, webu) {
    var newBlocks = webu.huc.filter("latest");
    newBlocks.watch(function (error, log) {

        if(error) {
            console.log('Error: ' + error);
        } else if (log == null) {
            console.log('Warning: null block hash');
        } else {
            grabBlock(config, webu, log);
        }

    });
}

var grabBlock = function(config, webu, blockHashOrNumber) {
    var desiredBlockHashOrNumber;

    // check if done
    if(blockHashOrNumber == undefined) {
        return; 
    }

    if (typeof blockHashOrNumber === 'object') {
        if('start' in blockHashOrNumber && 'end' in blockHashOrNumber) {
            desiredBlockHashOrNumber = blockHashOrNumber.end;
        }
        else {
            console.log('Error: Aborted becasue found a interval in blocks ' +
                'array that doesn\'t have both a start and end.');
            process.exit(9);
        }
    }
    else {
        desiredBlockHashOrNumber = blockHashOrNumber;
    }

    if(webu.isConnected()) {

        webu.huc.getBlock(desiredBlockHashOrNumber, true, function(error, blockData) {
            if(error) {
                console.log('Warning: error on getting block with hash/number: ' +
                    desiredBlockHashOrNumber + ': ' + error);
            }
            else if(blockData == null) {
                console.log('Warning: null block data received from the block with hash/number: ' +
                    desiredBlockHashOrNumber);
            }
            else {
                if('terminateAtExistingDB' in config && config.terminateAtExistingDB === true) {
                    checkBlockDBExistsThenWrite(config, blockData);
                }
                else {
                    writeBlockToDB(config, blockData);
                }
                if (!('skipTransactions' in config && config.skipTransactions === true))
                    writeTransactionsToDB(config, blockData);
                if('listenOnly' in config && config.listenOnly === true) 
                    return;

                if('hash' in blockData && 'number' in blockData) {
                    // If currently working on an interval (typeof blockHashOrNumber === 'object') and 
                    // the block number or block hash just grabbed isn't equal to the start yet: 
                    // then grab the parent block number (<this block's number> - 1). Otherwise done 
                    // with this interval object (or not currently working on an interval) 
                    // -> so move onto the next thing in the blocks array.
                    if(typeof blockHashOrNumber === 'object' &&
                        (
                            (typeof blockHashOrNumber['start'] === 'string' && blockData['hash'] !== blockHashOrNumber['start']) ||
                            (typeof blockHashOrNumber['start'] === 'number' && blockData['number'] > blockHashOrNumber['start'])
                        )
                    ) {
                        blockHashOrNumber['end'] = blockData['number'] - 1;
                        grabBlock(config, webu, blockHashOrNumber);
                    }
                    else {
                        grabBlock(config, webu, config.blocks.pop());
                    }
                }
                else {
                    console.log('Error: No hash or number was found for block: ' + blockHashOrNumber);
                    process.exit(9);
                }
            }
        });
    }
    else {
        console.log('Error: Aborted due to webu is not connected when trying to ' +
            'get block ' + desiredBlockHashOrNumber);
        process.exit(9);
    }
}


var writeBlockToDB = function(config, blockData) {
    return new Block(blockData).save( function( err, block, count ){
        if ( typeof err !== 'undefined' && err ) {
            if (err.code == 11000) {
                console.log('Skip: Duplicate key ' + 
                blockData.number.toString() + ': ' + 
                err);
            } else {
               console.log('Error: Aborted due to error on ' + 
                    'block number ' + blockData.number.toString() + ': ' + 
                    err);
               process.exit(9);
           }
        } else {
            if(!('quiet' in config && config.quiet === true)) {
                console.log('DB successfully written for block number ' +
                    blockData.number.toString() );
            }            
        }
      });
}

/**
  * Checks if the a record exists for the block number then ->
  *     if record exists: abort
  *     if record DNE: write a file for the block
  */
var checkBlockDBExistsThenWrite = function(config, blockData) {
    Block.find({number: blockData.number}, function (err, b) {
        if (!b.length)
            writeBlockToDB(config, blockData);
        else {
            console.log('Aborting because block number: ' + blockData.number.toString() + 
                ' already exists in DB.');
            process.exit(9);
        }

    })
}

/**
    Break transactions out of blocks and write to DB
**/

var writeTransactionsToDB = function(config, blockData) {
    var bulkOps = [];
    if (blockData.transactions.length > 0) {
        for (d in blockData.transactions) {
            var txData = blockData.transactions[d];
            txData.timestamp = blockData.timestamp;
            txData.value = hucUnits.toHuc(new BigNumber(txData.value), 'wei');
            bulkOps.push(txData);
        }
        Transaction.collection.insert(bulkOps, function( err, tx ){
            if ( typeof err !== 'undefined' && err ) {
                if (err.code == 11000) { console.log('Skip: Duplicate key ' +   err);
                } else {
                   console.log('Error: Aborted due to error: ' +  err);
                   process.exit(9);
               }
            } else if(!('quiet' in config && config.quiet === true)) {
                console.log('DB successfully written for block ' + blockData.transactions.length.toString() );
            }
        });
    }
}

/*
  Patch Missing Blocks
*/
var patchBlocks = function(config) {

    // console.log(webu);
    var webu = new Webu(new Webu.currentProvider.HttpProvider('http://localhost:' + config.ghucPort.toString()));

    // number of blocks should equal difference in block numbers
    var firstBlock = 0;
    var lastBlock = webu.huc.blockNumber;
    blockIter(webu, firstBlock, lastBlock, config);
}

var blockIter = function(webu, firstBlock, lastBlock, config) {
    // if consecutive, deal with it
    if (lastBlock < firstBlock)
        return;
    if (lastBlock - firstBlock === 1) {
        [lastBlock, firstBlock].forEach(function(blockNumber) {
            Block.find({number: blockNumber}, function (err, b) {
                if (!b.length)
                    grabBlock(config, webu, firstBlock);
            });
        });
    } else if (lastBlock === firstBlock) {
        Block.find({number: firstBlock}, function (err, b) {
            if (!b.length)
                grabBlock(config, webu, firstBlock);
        });
    } else {

        Block.count({number: {$gte: firstBlock, $lte: lastBlock}}, function(err, c) {
          var expectedBlocks = lastBlock - firstBlock + 1;
          if (c === 0) {
            grabBlock(config, webu, {'start': firstBlock, 'end': lastBlock});
          } else if (expectedBlocks > c) {
            console.log("Missing: " + JSON.stringify(expectedBlocks - c));  
            var midBlock = firstBlock + parseInt((lastBlock - firstBlock)/2); 
            blockIter(webu, firstBlock, midBlock, config);
            blockIter(webu, midBlock + 1, lastBlock, config);
          } else 
            return;
        })
    }
}


/** On Startup **/
// ghuc --rpc --rpcaddr "localhost" --rpcport "8545"  --rpcapi "huc,net,webu"

var config = {};

try {
    var configContents = fs.readFileSync('config.json');
    console.log('configContents:',configContents);
    config = JSON.parse(configContents);
}
catch (error) {
    if (error.code === 'ENOENT') {
        console.log('No config file found. Using default configuration (will download all blocks starting from latest)');
    }
    else {
        throw error;
        process.exit(1);
    }
}

// set the default ghuc port if it's not provided
if (!('ghucPort' in config) || (typeof config.ghucPort) !== 'number') {
    config.ghucPort = 8545; // default
}

// set the default output directory if it's not provided
if (!('output' in config) || (typeof config.output) !== 'string') {
    config.output = '.'; // default this directory
}

// set the default blocks if it's not provided
if (!('blocks' in config) || !(Array.isArray(config.blocks))) {
    config.blocks = [];
    config.blocks.push({'start': 0, 'end': 'latest'});
}

console.log('Using configuration:');
console.log(config);

grabBlocks(config);
// patchBlocks(config);
