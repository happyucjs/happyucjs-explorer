require( '../db-internal.js' );

var express = require('express');
var app = express();

var querystring = require('querystring');
var http = require('http');

var mongoose = require( 'mongoose' );
var InternalTx     = mongoose.model( 'InternalTransaction' );

const BATCH_SIZE = 10;

function grabInternalTxs(batchNum) {
  var post_data = querystring.stringify({
    "jsonrpc":"2.0",
    "method":"trace_filter",
    "params":[{"fromBlock":batchNum, "toBlock": batchNum + BATCH_SIZE}],
    "id":batchNum
  });

  var post_options = {
      host: 'localhost',
      port: '8545',
      path: '/',
      method: 'POST'
  };

  var post_req = http.request(post_options, function(res) {
      res.setEncoding('utf8');
      res.on('data', function (chunk) {
          console.log(chunk);
          console.log('Response: ' + chunk.result);
          for (d in chunk.result) {
            writeTxToDB(chunk.result[d]);
          }
      });
  });

  post_req.write(post_data);
  post_req.end();

}

var writeTxToDB = function(txData) {
    return new InternalTx(txData).save( function( err, tx, count ){
        if ( typeof err !== 'undefined' && err ) {
            if (err.code == 11000) {
                console.log('Skip: Duplicate key ' + 
                txData.number.toString() + ': ' + 
                err);
            } else {
               console.log('Error: Aborted due to error: ' + 
                    err);
               process.exit(9);
           }
        } else {
            console.log('DB successfully written for block number ' +
                txData.blockNumber.toString() );
        }
      });
}

grabInternalTxs(10)