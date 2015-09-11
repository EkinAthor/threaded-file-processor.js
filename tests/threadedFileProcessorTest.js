var ThreadedFileProcessorTest = function(options) {
	var opts = this._opts = {};
	this._opts.maxIterations = options.maxIterations || 5;
	this.file = options.file;
	this.scriptFilesLocation = options.scriptFilesLocation;
	this._opts.numberOfLines = options.numberOfLines || -1;
	this.results = [];
	this.processingCount = 0;
};
ThreadedFileProcessorTest.prototype._allProcessed = function() {
	if(this.processingCount >= (this._opts.maxIterations * 2)) {
		return true;
	} else {
		return false;
	}
};

ThreadedFileProcessorTest.prototype.start = function(callback) {
	var _this = this;
	for(var i = 0; i<this._opts.maxIterations; i++) {
		var j = new ThreadedFileProcessor({file: _this.file, threaded: true, logging: true, scriptFilesLocation: this.scriptFilesLocation});
		var k = new ThreadedFileProcessor({file: _this.file, threaded: false, logging:true, scriptFilesLocation: this.scriptFilesLocation});
		j.on("end", _this.processResult.bind(_this, true));
		j.start();
		k.on("end", _this.processResult.bind(_this, false));
		k.start();
	}
};

ThreadedFileProcessorTest.prototype.processResult = function(threaded, numberOfLines) {
	this.processingCount++;
	this.results.push({threaded: threaded, numberOfLines: numberOfLines});
	console.log(numberOfLines);
	this.report();
};

ThreadedFileProcessorTest.prototype.report = function() {
	var _this = this;
	var check = true;
	var noOfLines = this.results[0].numberOfLines;
	if(this._allProcessed()) {
		for(var i = 0; i < this.results.length; i++) {
			var nl = _this.results.pop().numberOfLines;
			if(nl != _this._opts.numberOfLines && _this._opts.numberOfLines != -1) {
				check = false;
				console.log("number of lines don't match defined");
			}
			if( nl != noOfLines) {
				check = false;
				console.log("numberOfLines inconsistent");
			}
		}
		console.log(check);
	}
};