var ThreadedFileProcessor = function(options) {
	var opts = this._opts = {};
	//required options
	this._opts.file = options.file;
	this._opts.scriptFilesLocation = options.scriptFilesLocation;

	//--------optional options---------
	this.metadata = options.metadata || {fileMetadata: {parseFields: false, lineSeparator: "\n",fieldSeparator: ";", parser: "csv", ignoreFields: true, stringQualifier: "\"", stringQualifierEscape: "\"", treatAllAsStrings: true}};
	//threaded - if true, then each part of the file will be processed by web worker in separate thread
	if(options.threaded !== undefined) {
		this.threaded = options.threaded;
	} else {
		this.threaded = false;
	}
	if(options.ignoreFirstLine !== undefined) {
		this.ignoreFirstLine = options.ignoreFirstLine;
	} else {
		this.ignoreFirstLine = false;
	}
	//maximum number of threads(processors) to use
	this._opts.maxThreads = options.maxThreads || 4;
	//starting file position. Override this to "resume"
	//TODO don't use, sync on remnants not complete
	this.filePosition = options.filePosition || 0;
	//size of the chunk of file for single read
	this._opts.chunkSize = options.chunkSize || 2048;
	if(options.logging !== undefined) {
		this._opts.logging = options.logging;
	} else {
		this._opts.logging = false;
	}


	this.lineProcessingScripts = new LineProcessingScripts({});

	//------Computed options--------
	this._opts.fileSize = this._opts.file.size;

	//------Options for line processor---------
	this._opts.newLineChar = options.newLineChar || "\n";

	//------Hard set detaults-----------------
	//max characters in the remnants buffer, process if buffer larger
	this._opts.maxRemnantsLength = 200;

	//------Variable initializations
	//counting number of processed lines
	this.counter = 0;
	//remnantsBuffer stores parts of first and last lines in the chunk of data (if you read chunk, you will probably start and end somewhere in the middle of the line)
	this.remnantsBuffer = [];
	this.remnantsBuffer.push({id:0, data:""});
	this.chunkId = -1;
	//stores completed lines fom remnantsBuffer
	this.postProcessor = "";
	this.lineProcessors = [];
	this.readerBusy = false;
	//when I read the file but there is no free worker to process the chunk, I will put the chunk here
	this.compensationBuffer = [];
	this._events = [];
	this.reader = new FileReader();
	var _this=this;
	this.reader.onload = function() {
		_this.readerBusy = false;
		_this.log("chunk Read");
		if(!_this.threaded) {
			var freeProcessors = _this.getFreeLineProcessors();
			if(freeProcessors.length > 0) {
				freeProcessors[0].setData(this.result);
				freeProcessors[0].setChunkId(_this.chunkId);
				freeProcessors[0].start();
			} else {
				_this.log("storing chunk in buffer");
				_this.compensatonBuffer.push({chunkId: _this.chunkId, data: this.result});
			}
			if(_this._hasMoreData() && _this.getFreeLineProcessors().length > 0 && !_this.readerBusy) {
				_this._readNext();	
			}
		} else {
			var freeWorkers = _this.getFreeWorkers();
			if(freeWorkers.length > 0) {
				freeWorkers[0].worker.postMessage({command: "setData", data: this.result});
				freeWorkers[0].worker.postMessage({command: "setChunkId", data: _this.chunkId});
				freeWorkers[0].free = false;
				freeWorkers[0].worker.postMessage({command: "start"});
			} else {
				_this.log("storing chunk in buffer");
				_this.compensationBuffer.push({chunkId: _this.chunkId, data: this.result});
			}
			if(_this._hasMoreData() && _this.getFreeWorkers().length > 0 && !_this.readerBusy) {
				_this._readNext();
			}
		}
	};

	//preparing line processors
	this.lineProcessors = [];
	for(var i =0; i<this._opts.maxThreads; i++) {
		var lp = new ThreadedLineProcessor({linePostProcess: this.lineProcessingScripts.linePostProcess, metadata: this.metadata, scriptFilesLocation: this._opts.scriptFilesLocation});
		lp.on("processed", _this._processNext.bind(_this));
		lp.on("firstLine", _this.addFirstLine.bind(_this));
		lp.on("lastLine", _this.addLastLine.bind(_this));
		lp.on("line", _this.onLineProcess.bind(_this));	
		lp.on("parsedLine", _this.onParsedLineProcess.bind(_this));	
		_this.lineProcessors.push(
				lp
			);
	}

	//preparing line processors in webworker mode
	this.lineWorkers = [];
	if(this.threaded) {
		for(var j=0; j<this._opts.maxThreads; j++) {
			var worker = new Worker(this._opts.scriptFilesLocation+"/threadedLineProcessor.js");
			worker.postMessage({command: "setup", data: {workerId: j, metadata: this.metadata, scriptFilesLocation: this._opts.scriptFilesLocation}});
			this.lineWorkers[j] = {worker: worker,
									free: true,
									id:j};
			worker.onmessage = _this.onMessage.bind(_this);
		}
	}

	//one extra line processor used to process last line in the chunk (using this to avoid unecessary conflicts with main pool)
	this.lineProcessor = new ThreadedLineProcessor({linePostProcess: this.lineProcessingScripts.linePostProcess, metadata: this.metadata, scriptFilesLocation: this._opts.scriptFilesLocation});
	this.lineProcessor.on("processed", function() {
		if(_this._endRead()) {
			_this.log("end read");
			_this._emit("end", [_this.counter]);
			var dt = new Date();
			_this.log("time "+(dt - _this.dt1)/1000);
		}	
	});
	this.lineProcessor.on("line", this.onLineProcess.bind(this));
	this.lineProcessor.on("parsedLine", this.onParsedLineProcess.bind(this));	
};

/**
 * [helper util function to format and display logs (when enabled)]
 * @param  {String} message [message to be displaywed]
 * 
 */
ThreadedFileProcessor.prototype.log = function(message) {
	if(this._opts.logging) {
		var dt = new Date();
		console.log(dt.getUTCHours() + ":" + dt.getUTCMinutes()+ ":"+ dt.getUTCSeconds() +"."+dt.getUTCMilliseconds()+ " " + message);
	}
};

/**
 * [Handler for worker messages. Same as emit for LineReaders]
 * @param  {object} message [message created by lineProcessor: {command: String, data: Object}]
 */
ThreadedFileProcessor.prototype.onMessage = function(message) {
	var msg = message.data;
	if(msg.command == "processed") {
		if(this.lineWorkers[msg.workerId]) {
			this.lineWorkers[msg.workerId].free = true;	
		}
		this._processNext();
	}
	if(msg.command == "firstLine") {
		this.addFirstLine(msg.data[0],msg.data[1]);
	}
	if(msg.command == "lastLine") {
		this.addLastLine(msg.data[0],msg.data[1]);
	}
	if(msg.command == "line") {
		this.onLineProcess(msg.data);
	}
	if(msg.command == "parsedLine") {
		this.onParsedLineProcess(msg.data);
	}
};

/**
 * Method called after every line is processed. This is only place where line value reaches reader. If not used, it is discarded
 * @param  {Object} line - representation of parsed line from processor
 */
ThreadedFileProcessor.prototype.onLineProcess = function(line) {

		this.counter++;
		this._emit("line", [line]);

};

ThreadedFileProcessor.prototype.onParsedLineProcess = function(line) {

		this._emit("parsedLine", [line]);

};

/**
 * Util method that returns array of free (unused) Line Processors
 * @return {array(lineProcessor)} array of line processors that are not active
 */
//TODO don't use .filter, not IE compatible without emacs
ThreadedFileProcessor.prototype.getFreeLineProcessors = function() {
	return this.lineProcessors.filter(function(processor){
		return processor.free;
	});
};

/**
 * Util method returning array of free (unised) webWorkers (line processors)
 * @return {array(webWorker)} array of web workers not currently processing a data chunk
 */
ThreadedFileProcessor.prototype.getFreeWorkers = function() {
	return this.lineWorkers.filter(function(worker){
		return worker.free;
	});
};

/**
 * checking if we read all the data
 * @return {Boolean} true if all data have been read and no active workers/processors working
 */
ThreadedFileProcessor.prototype._endRead = function() {
	var x = this.getFreeWorkers();
	if(this.threaded) {
		if(!this._hasMoreData() && this.getFreeWorkers().length >= this._opts.maxThreads && !this.readerBusy) {
			return true;
		} else {
			return false;
		}
	} else {
		if(!this._hasMoreData() && !this.readerBusy && this.getFreeLineProcessors().length >= 4) {
			return true;
		} else {
			return false;
		}
	}
};

/**
 * processing next chunk of data. Processes last line if at the end of the file
 * 
 */
ThreadedFileProcessor.prototype._processNext = function() {
	var _this = this;
		if(_this._hasMoreData()) {
			if(!_this.readerBusy) {
				_this._readNext();
			}
		} else if (this._endRead()) {
			//we are at the end of the file
			if(this.remnantsBuffer.length > 0) {
				//add remains of the buffer (if any) to the processing queue
				if(this.postProcessor !== "") {this.postProcessor += this._opts.newLineChar;}
				this.postProcessor += this.remnantsBuffer.pop().data; 
			}
			if(this.postProcessor !== "") {
				//process remainder of the buffer
				this.lineProcessor.setData(_this.postProcessor);
				this.postProcessor = "";
				this.lineProcessor.setChunkId(-1);
				this.lineProcessor.start();
			} else {
				_this.log("end read");
				var dt = new Date();
				_this._emit("end", [_this.counter]);
				_this.log("processing time  "+(dt - _this.dt1)/1000);
			}
		}

};

/**
 * helper method. Based on id of the chunk finds the position in remnants array
 * @param  {Integer} id - id of the data chunk
 * @return {Integer}    - id of the array item holding the line
 */
ThreadedFileProcessor.prototype.findRemnantsId = function(id) {
	//I would use findIndex for this...except EMACS 2015 don't work in IE :(
	var index;
	for(var i=0; i<this.remnantsBuffer.length; i++) {
		if(this.remnantsBuffer[i].id == id) {
			index = i;
			return index;
		}
	}
	return index;
};

/**
 * adds first line to the remnantsBuffer. If the buffer already contains last line from previous chunk, concatenate and add to the postProcessor (we now have full line)
 * also checks if we have full buffer and if we do, process it
 * @param {Integer} id   -chunk id
 * @param {String} data -line (partial)
 */
ThreadedFileProcessor.prototype.addFirstLine = function(id,data) {
	if(id==0){
		var _this = this;
		this.processFirstLine(data, function(processedLine) {			
			_this._emit("firstLineProcessed", [processedLine]);
		});
		if(this.ignoreFirstLine) {
			data ="";	
		}	
	}
	
	var index = this.findRemnantsId(id);
	if(index !== undefined) {
		if(this.postProcessor !== "" ) {this.postProcessor += this._opts.newLineChar;}
		this.postProcessor = this.postProcessor + this.remnantsBuffer.splice(index,1)[0].data + data;
	} else {
		this.remnantsBuffer.push({id: id, data: data});
	}
	if(this.postProcessor.length > this._opts.maxRemnantsLength) {
		this.processRemnant();
	}
};

/**
 adds last line to the remnantsBuffer. If the buffer already contains first line from next chunk, concatenate and add to the postProcessor (we now have full line)
 * also checks if we have full buffer and if we do, process it
 * @param {Integer} id   -chunk id
 * @param {String} data -line (partial)
 */
ThreadedFileProcessor.prototype.addLastLine = function(id,data) {
	var index = this.findRemnantsId(id +1);
	if(index !== undefined) {
		if(this.postProcessor !== "" ) {this.postProcessor += this._opts.newLineChar;}
		this.postProcessor = this.postProcessor + data +  this.remnantsBuffer.splice(index,1)[0].data;
	} else {
		this.remnantsBuffer.push({id:(id+1), data:data});
		this.fck=1;
	}
	if(this.postProcessor.length > this._opts.maxRemnantsLength) {
		this.processRemnant();
	}
};

/**
 * Process remnants buffer
 * 
 */
ThreadedFileProcessor.prototype.processRemnant = function() {
	this.lineProcessor.setData(this.postProcessor);
	this.postProcessor = "";
	this.lineProcessor.setChunkId(-1);
	this.lineProcessor.start();
};

/**
 * check if we read the file (this does not mean we are finished, processors and readers can still be active)
 * @return {Boolean} file read
 */
ThreadedFileProcessor.prototype._hasMoreData = function() {
	return this.filePosition <= this._opts.fileSize;
};

/**
 * reads next chunk of data. If compensation buffer is not empty, process that data first
 * 
 */
ThreadedFileProcessor.prototype._readNext = function() {
	var _this = this;
	if(this.compensationBuffer.length > 0) {
		if(!_this.threaded) {
			var freeProcessors = _this.getFreeLineProcessors();
			if(freeProcessors.length > 0) {
				var dt = _this.compensationBuffer.pop();
				freeProcessors[0].setData(dt.data);
				freeProcessors[0].setChunkId(dt.chunkId);
				freeProcessors[0].start();
			} else {
				_this.log("adding chunk to compensation buffer");
			}
			if(_this._hasMoreData() && _this.getFreeLineProcessors().length > 0 && !_this.readerBusy) {
				_this._readNext();	
			}
		} else {
			var freeWorkers = _this.getFreeWorkers();
			if(freeWorkers.length > 0) {
				var dt = this.compensationBuffer.pop();
				freeWorkers[0].worker.postMessage({command: "setData", data: dt.data});
				freeWorkers[0].worker.postMessage({command: "setChunkId", data: dt.chunkId});
				freeWorkers[0].free = false;
				freeWorkers[0].worker.postMessage({command: "start"});
			} else {
				_this.log("adding chunk to compensation buffer");
			}
			if(_this._hasMoreData() && _this.getFreeWorkers().length > 0 && !_this.readerBusy) {
				_this._readNext();
			}
		}
	} else {
		this.chunkId++;
		var fileSlice = this._opts.file.slice(this.filePosition, this.filePosition+this._opts.chunkSize);
		_this.log("reading "+this.filePosition+"->"+(this.filePosition+this._opts.chunkSize));
		this.readerBusy=true;
		this.reader.readAsText(fileSlice);
		this.filePosition = this.filePosition + this._opts.chunkSize;
	}
};

/**
 * Start processing
 * 
 */
ThreadedFileProcessor.prototype.start = function() {
	this.dt1 = new Date();
	this._readNext();
};

/**
 * Utils - handling events
 * 
 */
	ThreadedFileProcessor.prototype.on = function (event, callBack) {
  		this._events[ event ] = callBack;
	};

	ThreadedFileProcessor.prototype._emit = function (event, args) {
  		if ( typeof this._events[event] === 'function' ) {
    		this._events[event].apply(this, args);
 		 }
	};
/**
 * Utils - other
 */

/**
 * processes one single line
 * @return array representation of line
 */
ThreadedFileProcessor.prototype.processFirstLine = function(data,callBack) {
	var _this = this;
	//extra reader just to process first chunk and parse first line asynchronously
	var lineProcessor = new ThreadedLineProcessor({linePostProcess: _this.lineProcessingScripts.linePostProcess, metadata: _this.metadata, scriptFilesLocation: _this._opts.scriptFilesLocation});
		//lineProcessor.on("processed", function() {});
		//this.lineProcessor.on("line", this.onLineProcess.bind(this));
		lineProcessor.on("parsedLine", function(data) {
			callBack(data);
		});	
		lineProcessor.setData(data);
		lineProcessor.setChunkId(-1);
		lineProcessor.start();
}
