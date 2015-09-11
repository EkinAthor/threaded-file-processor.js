var ThreadedLineProcessor = function(options) {
	var opts = this._opts = {};
	this.metadata =  options.metadata;
	this.scriptFilesLocation = options.scriptFilesLocation;
	this.metaUtils = new metaUtils(this.metadata);
	this.stringRegexp = this.createStringRegexp();
	this.lineRegexp = this.createLineRegexp();
	if(options.workerId !== undefined) {
		this.workerId = options.workerId;
	} else {
		this.workerId = -1;
	}

	if(options.linePostProcess !== undefined) {
		this._linePostProcess = options.linePostProcess;
	} else {
		this._linePostProcess = function(line) {return line;};
	}
	if(options.linePreProcess !== undefined) {
		this._linePreProcess = options.linePreProcess;
	} else {
		this._linePreProcess = function(line) {return line;};
	}
	if(options.parsedLinePreProcess !== undefined) {
		this._parsedLinePostProcess = options.parsedLinePreProcess;
	} else {
		this._parsedLinePostProcess = function(line) {return line;};
	}
	this.free = true;
	this._opts.newLineChar = options.newLineChar || "\n";
	this._opts.newLine = new RegExp(this._opts.newLineChar);
	this.chunkId = 0;
	this.data = options.data || "";
	this.lines = [];
	this._events = {};
	//if not used as worker, do this
	if(typeof window != 'undefined') {
		self.postMessage = function() {};
	} else {
		importScripts(this.scriptFilesLocation+"/lineProcessingScripts.js");

	}
	this.lineProcessingScripts = new LineProcessingScripts({});
	this._linePostProcess = this.lineProcessingScripts.linePostProcess;
	this._linePreProcess = this.lineProcessingScripts.linePreProcess;
	this._parsedLinePostProcess = this.lineProcessingScripts.parsedLinePostProcess;

};

ThreadedLineProcessor.prototype.setData = function(data) {
	this.data = data;
};
ThreadedLineProcessor.prototype.setChunkId = function(data) {
	this.chunkId = data;
};

ThreadedLineProcessor.prototype.setLinePostProcess = function(data) {
	this._linePostProcess = data;
};

ThreadedLineProcessor.prototype.parseLines = function() {

	if(this._opts.newLine.test(this.data)) {
			this.lines = this.data.split(this._opts.newLineChar);
			if(this.chunkId != -1) {
				var data1 = [this.chunkId,this.lines.shift()];
				this._emit("firstLine", data1);
				self.postMessage({command: "firstLine", data: data1});
				var data2 = [this.chunkId,this.lines.pop()];
				this._emit("lastLine", data2);
				self.postMessage({command: "lastLine", data: data2});
			}
		} else {
			this.lines[0] = this.data;
			if(this.chunkId != -1) {
				var data3 = [this.chunkId,this.lines.shift()];
				this._emit("fullLine", data3);	
				self.postMessage({command: "fullLine", data: data3});
			}
			
		}

	this._processLine();
};

ThreadedLineProcessor.prototype._processLine = function() {
	var parsedLine = {};
	if(this.lines.length > 0) {
		//line
		var line = this.lines.pop();
		line = this._linePreProcess(line, this.metaUtils);
		if(this.metaUtils.parser() == "csv") {
			//line parsing
			var LineParts = line.split(this.metaUtils.getFieldSeparator());
			if(LineParts.length != this.metaUtils.fields().length && !this.metaUtils.ignoreFields()) {
				var tmpParts = LineParts;
				LineParts = this.lineRegexp.exec(line);
				if(LineParts === null) {
						LineParts = tmpParts;
						//TODO report error
				} else {
						//first object is original text
					if(LineParts.length > 0) {LineParts.shift();}
				}
				
			} else {

			}

			parsedLine.originalData = line;
			parsedLine.fields = [];

			for(var i = 0; i< LineParts.length; i++) {
				parsedLine.fields.push({value: this.parseField(LineParts[i],this.metaUtils.getFieldType(i))});
			}

			line = this._linePostProcess(line, this.metaUtils);
			parsedLine = this._parsedLinePostProcess(parsedLine, this.metaUtils);
			this._emit("parsedLine", [parsedLine]);
			self.postMessage({command: "parsedLine", data: parsedLine});
		}
		this._emit("line",[line]);
		self.postMessage({command: "line", data: line});
		this._processLine();
	} else {
		this.free = true;
		this._emit("processed");
		self.postMessage({command: "processed", workerId: this.workerId});
	}
};

ThreadedLineProcessor.prototype.start = function() {
	this.free = false;
	this.parseLines();
};

ThreadedLineProcessor.prototype.createStringRegexp = function() {
	if(this.metaUtils.getStringQualifier() !== "") {
		var sq = this.metaUtils.getStringQualifier();
		var sqEscape = this.metaUtils.getStringQualifierEscape();
		if(sqEscape !== "") {
			return new RegExp("[^"+sqEscape+"]{0,}"+sq+"(.*)"+"[^"+sqEscape+"]{0,}"+sq);
		} else {
			return new RegExp(""+sq+"(.*)"+sq+"");
		}
		
	} else {
		return new RegExp("(.*)");
	}
};

ThreadedLineProcessor.prototype.createLineRegexp = function() {
	var regexString = "^";
	for(var i = 0; i<this.metaUtils.fields().length; i++) {
		if(i !== 0 ) {regexString += this.metaUtils.getFieldSeparator();}
		var fieldType = this.metaUtils.getFieldType(i);
		if(fieldType == "String") {
			regexString += this.createStringRegexp().source;
		} else {
			regexString += "(.*)";
		}
	}
	return new RegExp(regexString);
};

ThreadedLineProcessor.prototype.parseField = function(value,fieldType) {
	if(fieldType == "String" || this.metaUtils.treatAllAsStrings()) {
		return value.replace(this.stringRegexp, "$1");
	} 

	return value;
}; 

//Events handling
	ThreadedLineProcessor.prototype.on = function (event, callBack) {
  		this._events[ event ] = callBack;
	};

	ThreadedLineProcessor.prototype._emit = function (event, args) {
  		if ( typeof this._events[event] === 'function' ) {
    		this._events[event].apply(this, args);
 		 }
	};



var metaUtils = function(metadata) {
	this.metadata = metadata;
};

metaUtils.prototype.treatAllAsStrings = function() {
	if(this.metadata.fileMetadata.treatAllAsStrings !== undefined) {
		return this.metadata.fileMetadata.treatAllAsStrings;
	} else {
		return false;
	}
};

metaUtils.prototype.parser = function() {
	if(this.metadata.fileMetadata.parser !== undefined) {
		return this.metadata.fileMetadata.parser;
	} else {
		return "UndefinedParser";
	}
};


metaUtils.prototype.getFieldType = function(index) {
	if(this.metadata.fields !== undefined && this.metadata.fields[index] !== undefined) {
		if(this.metadata.fields[index].fieldType !== undefined) {
			return this.metadata.fields[index].fieldType;
		} else {
			return "UndefinedFieldType";
		}
	} else {
		return "UndefinedFieldType";
	}
};

metaUtils.prototype.getFieldSeparator = function() {
	return this.metadata.fileMetadata.fieldSeparator;
};

metaUtils.prototype.getStringQualifier = function() {
	if(this.metadata.fileMetadata.stringQualifier !== undefined) {
		return this.metadata.fileMetadata.stringQualifier;
	} else {
		return "";
	}
};
metaUtils.prototype.getStringQualifierEscape = function() {
	if(this.metadata.fileMetadata.stringQualifierEscape !== undefined) {
		return this.metadata.fileMetadata.stringQualifierEscape;
	} else {
		return "";
	}
};

metaUtils.prototype.fields = function() {
	if (this.metadata.fields !== undefined) {
		return this.metadata.fields;
	} else {
		return [];
	}
};

metaUtils.prototype.ignoreFields = function() {
	if(this.metadata.fileMetadata.ignoreFields !== undefined) {
		return this.metadata.fileMetadata.ignoreFields;
	} else {
		return true;
	}
};

//webworker messaging options
self.onmessage = function(message) {
	var msg = message.data;
	if(msg.command == "setup") {
		self.lp = new ThreadedLineProcessor({
			workerId : msg.data.workerId,
			metadata: msg.data.metadata,
			scriptFilesLocation: msg.data.scriptFilesLocation
		});
			
	}
	if(msg.command == "setData") {
		self.lp.setData(msg.data);
	}	
	if(msg.command == "setChunkId") {
		self.lp.setChunkId(msg.data);
	}
	if(msg.command == "setLinePostProcess") {
		self.lp.setLinePostProcess(msg.data);
	}
	if(msg.command == "start") {
		self.lp.start();
	}
};