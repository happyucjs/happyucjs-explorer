angular.module('BlocksApp').controller('TxController', function($stateParams, $rootScope, $scope, $http, $location) {
    $scope.$on('$viewContentLoaded', function() {   
        // initialize core components
        App.initAjax();
    });

    $rootScope.$state.current.data["pageSubTitle"] = $stateParams.hash;
    $scope.hash = $stateParams.hash;
    $scope.tx = {"hash": $scope.hash};
    $scope.settings = $rootScope.setup;

    //fetch webu stuff
    $http({
      method: 'POST',
      url: '/weburelay',
      data: {"tx": $scope.hash}
    }).success(function(data) {
      if (data.error) {
        if (data.isBlock) {
          // this is a blockHash
          $location.path("/block/" + $scope.hash);
          return;
        }
        $location.path("/err404/tx/" + $scope.hash);
        return;
      }
      $scope.tx = data;
      if (data.timestamp)
        $scope.tx.datetime = new Date(data.timestamp*1000); 
      if (data.isTrace) // Get internal txs
        fetchInternalTxs();
    });

    var fetchInternalTxs = function() {
      $http({
        method: 'POST',
        url: '/weburelay',
        data: {"tx_trace": $scope.hash}
      }).success(function(data) {
        $scope.internal_transactions = data;
      });      
    }
})
