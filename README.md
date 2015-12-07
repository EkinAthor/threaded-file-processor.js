# threaded-file-processor.js
Threaded file processor is wrapper around javascript FileReader functionality that provide support for reading large files and parsing in multiple threads on client side.
Core Functionality provided:
- Read file in chunks, process on-the-fly
- Process every chunk in separate thread (WebWorkers used in threaded mode)
- Provide event calls with data processed (Line, chunk, file, can be piped to a stream)
- User definned Line parser functions

This is meant to process huge files (10 of MB to TB) on client side, where adittional processing of the file is needed (usually before sent to a server). Example usages include:
- Pre-parsing file to send only speciffic subset of information
- Check for consistency
- Search on file on client side
- Encrypt file (up to a field level) on client side

If you don't need to process file on the client side, normal file reader is probably better choice for you. This is really meant for large files and processor intensive operations.

###Usage
To initialize library, simply load the js files and initialize class with set of **required attributes**:
```
var processor=new ThreadedFileProcessorTest({file:file, scriptFilesLocation: "../src"});
```
####Mandatory attributes

| Attribute | Description |
| --------- | ----------- |
| File [*file*]| File object. Probably object from file picker (input type='file') |
| scriptFilesLocation [*String*]| Default location for script files (folder where source files are) |
Note: why you need to provide the path to the script files? This library uses webWorkers functionality and thus needs to know where is the file to initialize webworker with. 

And then start the process by calling start method:
```
processor.start();
```

Just for the reference, here is most complete configuration options (described in detail below):
```
{
  file:file, 
  threaded: true, 
  maxThreads: 4,
  chunkSize: 2048,
  logging: true,
  newLineChar: "\n",
  metadata: {
    fileMetadata: {
      lineSeparator: "\n",
      fieldSeparator: ";", 
      ignoreFields: false, 
      stringQualifier: "\"", 
      stringQualifierEscape: "\"", 
      treatAllAsStrings: false,
      parser: "csv"
      }, 
    fields:[
          {name: "Field1", fieldType: "String"},
          {name: "Field2", fieldType: "String"},
    ]
  }
}
```

####Optional attributes
Processing with default attributes simply read file line by line and apply parsing functions on each line. Parsing functions are user defined and do nothing by default (with the exception of built-in CSV parser).
You can provide following optional attributes:

| Attribute | Description | Default |
| --------- | ----------- | ------- |
|threaded [*boolean*]|indicate whether to use web workers or just process evertything in single thread| *false* |
|maxThreads [*integer*]| maximum number of threads (workers spawned). | *4* |
|filePosition [*integer*] | experimental: starting position (in kb) in the file where reader starts reading data | *0* |
|ignoreFirstLine [*boolean*] | ignore first line in file (it will still emit event with first line) | *false* |
|chunkSize [*integer*] | how many kb from file to read at a time | *2048* |
|logging [*boolean*] | enables detailed logging | *false* |
|newLineChar [*String*] | default new line character to use in parsing | *\n* |
|metadata [*object*] | metadata to be used for file parsing (see below) | |

In order to provide file metadata for parsing, user can provide custom metadata object. Here are supported metadata attributes (althought user can add custom attributes that will be passed to line processing functions). Metadata are divided between **fileMetadata** and **fields**

#####fileMetadata
| Attribute | Description | Default |
| --------- | ----------- | ------- |
| lineSeparator [*String*] | line separator character | *\n* |
| fieldSeparator [*String*] | field separator character | *;* |
| stringQualifier [*String*] | string qualifier (in case of csv parsing) | *"* |
| stringQualifierEscape [*String*] | string qualifier escape (in case of string qualifier appearing inside of string) | *"* |
| treatAllAsStrings [*boolean*] | overrides column types and treats all fields as strings for purpose of parsing | *false* |
| parser [*enum*] | which parser o use when parsing line. Currently only **csv** is supported. If this is set to any other than csv, full line will be provided on the input (or anything else when user defined function present) | *none* |
|ignoreFields [*boolean*] | You can choose to ignore field consistency. I.e. when you don't know how many fields your file has, this will still parse the file with field separator, but ignores incostincensies. It will treat every field as undefined fieldType, unless "treatAllAsStrings" is set, in which case every field will be treated as string. | *true* |
|fields [*array*] | Object containing field information (see below) | *[ ]* |

#####fields
| Attribute | Description | Default |
| --------- | ----------- | ------- |
| name [*String*] | field name | *optional* |
| fieldType [*enum*] | field type for the purposes of parsing. Currently supported: String | *optional* |

####Events
File processor emits events when speciffic part of the file are processed. You should listen to the events in order to store/send data. File processor **does not save all data to object or memory**. It is up to user to decide what to do with each line of data processed.

| Event | Description | Attributes passed |
| --------- | ----------- | ----------------- |
| line | triggered when line is processed. | Passes original line (if not changed by pre-processing user defined function) |
| parsedLine | triggered when line is processed and parsed (including pre-process and post-process). Is not triggered when parser is not used. | Passes processed line object|
| firstLineProcessed | triggered when first line is parsed and processed (useable when you have to parse header in separate process) | Passes processed line object|
| end | indicates end of processing (callback should go here) | passes integer indicating number of lines processed |
Parsed Line Object:
```
{ originalData : "original line as read + preProcessed"
  fields: [ value : "parsed field"]
  }
  ```
  
####User defined processing functions
Processing functions can be found in the file **lineProcessingScripts.js**. This file shall be edited if you want to add custom function to a threaded processing (this is the place that leverages if you need to do some cpu heavy pre processing such as encrypting or search). 
We are using file here instead of letting user define their own functions in the object initialization, because those can not be passed to web worker in any meaningfull fashion. 
Functions that can be defined are called in this order:
Line read -> Line pre-process -> parsing -> line post-process -> parsed line post-process

#####linePreProcess(line, metaUtils)
Function recieves raw read line as first attribute and metaUtils containing metadata as second attribute. Should return String

#####linePostProcess(line, metaUtils)
Function recieves processed line as a first attribute and metaUtils containing metadata as second attribute. Can return any object.

#####parsedLinePostProcess(line, metaUtils)
Function recieves parsed line as parsedLineObject and metaUtils containing metadata as second attribute, can return any object.

####Current limitations
This is project still under development. I cant guarantee that some interfaces won't change. Current limitations include:
- data are not read in order that are in the file. This is caused by threaded nature of the process
- error reporting is very limited
- resume reading is currently limited
