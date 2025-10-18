# Creating a New MCP oJob YAML Server

This guide provides step-by-step instructions for creating a new oJob YAML file that acts as both a STDIO and HTTP-based MCP (Model Context Protocol) server, following the patterns established in the existing MCPs like `mcp-ch.yaml`, `mcp-db.yaml`, `mcp-email.yaml`, and `mcp-net.yaml`.

## Table of Contents

1. [Understanding the MCP Structure](#understanding-the-mcp-structure)
2. [File Structure Overview](#file-structure-overview)
3. [Step-by-Step Creation Guide](#step-by-step-creation-guide)
4. [Common Patterns and Best Practices](#common-patterns-and-best-practices)
5. [Testing Your MCP](#testing-your-mcp)
6. [Examples](#examples)

## Understanding the MCP Structure

All MCP oJob YAML files in this project follow a consistent pattern that enables dual-mode operation:

- **STDIO Mode**: Direct execution with communication via standard input/output
- **HTTP Mode**: Server mode activated by providing the `onport` parameter

## File Structure Overview

Every MCP YAML file contains these essential sections:

1. **Help Section**: Documentation and parameter definitions
2. **Todo Section**: Conditional logic for STDIO vs HTTP mode
3. **oJob Configuration**: OpenAF job configuration
4. **Include Section**: References to shared MCP functionality
5. **Jobs Section**: Implementation of MCP tools/functions

## Step-by-Step Creation Guide

### Step 1: Create the Basic File Structure

Create a new YAML file named `mcp-[your-service].yaml` with the following template:

```yaml
# Author: [Your Name]
help:
  text   : A STDIO/HTTP MCP [your service description] server
  expects:
  - name     : onport
    desc     : If defined starts a MCP server on the provided port
    example  : "8888"
    mandatory: false
  # Add your specific parameters here
  - name     : [param1]
    desc     : [Description of parameter]
    example  : [Example value]
    mandatory: [true/false]

todo:
- [Init job name]  # Your initialization job
- (if    ): "isDef(args.onport)"
  ((then)):
  - (httpdMCP): &MCPSERVER
      serverInfo:
        name   : mini-a-[service-name]
        title  : OpenAF mini-a MCP [service description] server
        version: 1.0.0
    ((fnsMeta)): &MCPFNSMETA
      # Define your MCP tools metadata here
    ((fns    )): &MCPFNS
      # Define your MCP tools friendly names here
  ((else)):
  - (stdioMCP ): *MCPSERVER
    ((fnsMeta)): *MCPFNSMETA
    ((fns    )): *MCPFNS

ojob:
  opacks      :
  - openaf     : 20250915
  - oJob-common: 20250914
  catch       : printErrnl("[" + job.name + "] "); $err(exception, __, __, job.exec)
  logToConsole: false   # to change when finished
  argsFromEnvs: true
  daemon      : true
  unique      :
    pidFile     : .mcp-[service-name].pid
    killPrevious: true

include:
- oJobMCP.yaml

jobs:
# Your job implementations go here
```

### Step 2: Define Help Documentation

Fill in the `help` section with comprehensive documentation:

```yaml
help:
  text   : A STDIO/HTTP MCP [your service description] server
  expects:
  - name     : onport
    desc     : If defined starts a MCP server on the provided port
    example  : "8888"
    mandatory: false
  - name     : [your_param]
    desc     : [Detailed description of what this parameter does]
    example  : [Concrete example value]
    mandatory: [true/false]
  - name     : libs
    desc     : Optional comma separated libraries or @oPack/library.js references to preload
    example  : "@openaf/helpers.js,lib/custom.js"
    mandatory: false
  # Add more parameters as needed
```

Tip: include a `libs` parameter when your MCP may need to preload optional helpers or oPack modules at runtime, mirroring how built-in MCPs expose this flexibility.

### Step 3: Define MCP Tool Metadata

In the `((fnsMeta))` section, define each MCP tool with proper JSON Schema:

```yaml
((fnsMeta)): &MCPFNSMETA
  your-tool-name:
    name       : your-tool-name
    description: [Detailed description of what this tool does]
    inputSchema:
      type      : object
      properties:
        param1:
          type        : string
          description : [Description of parameter]
        param2:
          type        : integer
          description : [Description of parameter]
          # Add more parameters as needed
      required: [ param1 ]  # List required parameters
    annotations:
      title         : your-tool-name
      readOnlyHint  : [true for read operations, false for write operations]
      idempotentHint: [true if repeated calls with same input produce same result]
```

### Step 4: Define Tool Friendly Names

In the `((fns))` section, provide user-friendly names:

```yaml
((fns    )): &MCPFNS
  your-tool-name: [Friendly display name]
  another-tool  : [Another friendly name]
```

### Step 5: Implement Initialization Jobs

Create initialization and cleanup jobs:

```yaml
jobs:
# ---------------------------
- name : [Your Init Job Name]
  check:
    in:
      param1: isString
      param2: isString.default(__)  # Optional parameter with default
  exec : | #js
    // Optional: preload helper libraries or oPack modules
    if (isDef(args.libs) && args.libs.length > 0) {
      args.libs.split(",")
        .map(function(lib) { return lib.trim() })
        .filter(function(lib) { return lib.length > 0 })
        .forEach(function(lib) {
          log("Loading library: " + lib + "...")
          try {
            if (lib.startsWith("@")) {
              if (/^\@([^\/]+)\/(.+)\.js$/.test(lib)) {
                var match = lib.match(/^\@([^\/]+)\/(.+)\.js$/)
                var packPath = getOPackPath(match[1])
                var filePath = packPath + "/" + match[2] + ".js"
                if (io.fileExists(filePath)) {
                  loadLib(filePath)
                } else {
                  logErr("[ERROR] Library '" + lib + "' not found.")
                }
              } else {
                logErr("[ERROR] Library '" + lib + "' does not have the correct format (@oPack/library.js).")
              }
            } else {
              loadLib(lib)
            }
          } catch(e) {
            logErr("[ERROR] Failed to load library " + lib + ": " + e.message)
          }
        })
    }
    // Initialize your service here
    // Store global state in global.* variables
    global.yourServiceClient = // Your initialization code

# ----------------------------------
- name : [Your Cleanup Job Name]
  type : shutdown
  exec : | #js
    // Cleanup resources when shutting down
    if (isDef(global.yourServiceClient)) {
      try {
        global.yourServiceClient.close()
      } catch(e) {
        logErr("Error during cleanup: " + e)
      }
      global.yourServiceClient = undefined
    }
```

### Step 6: Implement MCP Tool Jobs

Create jobs that correspond to your MCP tools:

```yaml
# --------------------------
- name : [Friendly Tool Name]
  check:
    in:
      param1: isString
      param2: isString.default(__)
      param3: toBoolean.isBoolean.default(false)
  exec : | #js
    // Validate global state
    if (!isDef(global.yourServiceClient)) {
      return "[ERROR] Service not initialized"
    }

    try {
      // Implement your tool logic here
      var result = global.yourServiceClient.doSomething(args.param1, args.param2)
      return result
    } catch(e) {
      logErr("Error in tool execution: " + e)
      return "[ERROR] " + e.message
    }
```

### Step 7: Configure oJob Settings

Ensure your oJob configuration includes necessary settings:

```yaml
ojob:
  opacks      :
  - openaf     : 20250915
  - oJob-common: 20250914
  catch       : printErrnl("[" + job.name + "] "); $err(exception, __, __, job.exec)
  logToConsole: false   # Set to true for debugging
  argsFromEnvs: true
  daemon      : true
  unique      :
    pidFile     : .mcp-[service-name].pid
    killPrevious: true
  owraps      : # Add any required OpenAF wrappers
  - [WrapperName]
```

## Common Patterns and Best Practices

### Error Handling

Always return error messages with the `[ERROR]` prefix:

```javascript
if (errorCondition) {
  return "[ERROR] Description of the error"
}
```

### Global State Management

Use global variables to maintain service state:

```javascript
// In initialization job
global.serviceClient = new ServiceClient(args.connectionString)

// In tool jobs
if (!isDef(global.serviceClient)) {
  return "[ERROR] Service not initialized"
}
```

### Parameter Validation

Use oJob's `check` section for parameter validation:

```yaml
check:
  in:
    required_param: isString
    optional_param: isString.default("default_value")
    boolean_param : toBoolean.isBoolean.default(false)
    number_param  : toNumber.isNumber.default(0)
```

### Read-Only vs Write Operations

Implement read-only flags for tools that modify data:

```javascript
// For write operations, check read-only mode
if (!args.allowWrite) {
  return "[ERROR] Read-only mode. Set allowWrite=true to allow write operations"
}
```

### Resource Cleanup

Always implement shutdown jobs for proper cleanup:

```yaml
- name : Cleanup Resources
  type : shutdown
  exec : | #js
    // Cleanup code here
```

## Testing Your MCP

### STDIO Mode Testing

Test your MCP in STDIO mode:

```bash
# List available tools
oafp in=mcp data="(cmd: 'ojob mcps/mcp-[service].yaml [params]')" inmcptoolslist=true

# Call a specific tool
oafp in=mcp data="(cmd: 'ojob mcps/mcp-[service].yaml [params]', tool: [tool-name], params: (param1: 'value1'))"
```

### HTTP Mode Testing

Test your MCP in HTTP server mode:

```bash
# Start the HTTP server
ojob mcps/mcp-[service].yaml onport=12345 [other-params]

# In another terminal, test the remote MCP
oafp in=mcp data="(type: remote, url: 'http://localhost:12345/mcp')" inmcptoolslist=true

oafp in=mcp data="(type: remote, url: 'http://localhost:12345/mcp', tool: [tool-name], params: (param1: 'value1'))"
```

## Examples

### Example 1: Simple Calculator MCP

```yaml
# Author: Example
help:
  text   : A STDIO/HTTP MCP calculator server
  expects:
  - name     : onport
    desc     : If defined starts a MCP server on the provided port
    example  : "8888"
    mandatory: false

todo:
- (if    ): "isDef(args.onport)"
  ((then)):
  - (httpdMCP): &MCPSERVER
      serverInfo:
        name   : mini-a-calc
        title  : OpenAF mini-a MCP calculator server
        version: 1.0.0
    ((fnsMeta)): &MCPFNSMETA
      add:
        name       : add
        description: Adds two numbers
        inputSchema:
          type      : object
          properties:
            a:
              type        : number
              description : First number
            b:
              type        : number
              description : Second number
          required: [ a, b ]
        annotations:
          title         : add
          readOnlyHint  : true
          idempotentHint: true
    ((fns    )): &MCPFNS
      add: Add Numbers
  ((else)):
  - (stdioMCP ): *MCPSERVER
    ((fnsMeta)): *MCPFNSMETA
    ((fns    )): *MCPFNS

ojob:
  opacks      :
  - openaf     : 20250915
  - oJob-common: 20250914
  catch       : printErrnl("[" + job.name + "] "); $err(exception, __, __, job.exec)
  logToConsole: false
  argsFromEnvs: true
  daemon      : true

include:
- oJobMCP.yaml

jobs:
- name : Add Numbers
  check:
    in:
      a: toNumber.isNumber
      b: toNumber.isNumber
  exec : | #js
    return args.a + args.b
```

### Example 2: File Operations MCP

```yaml
# Author: Example
help:
  text   : A STDIO/HTTP MCP file operations server
  expects:
  - name     : onport
    desc     : If defined starts a MCP server on the provided port
    example  : "8888"
    mandatory: false
  - name     : basePath
    desc     : Base path for file operations (security restriction)
    example  : "/safe/directory"
    mandatory: true

todo:
- Init file service
- (if    ): "isDef(args.onport)"
  ((then)):
  - (httpdMCP): &MCPSERVER
      serverInfo:
        name   : mini-a-files
        title  : OpenAF mini-a MCP file operations server
        version: 1.0.0
    ((fnsMeta)): &MCPFNSMETA
      read-file:
        name       : read-file
        description: Reads content from a file
        inputSchema:
          type      : object
          properties:
            filename:
              type        : string
              description : Name of file to read
          required: [ filename ]
        annotations:
          title         : read-file
          readOnlyHint  : true
          idempotentHint: true
    ((fns    )): &MCPFNS
      read-file: Read File
  ((else)):
  - (stdioMCP ): *MCPSERVER
    ((fnsMeta)): *MCPFNSMETA
    ((fns    )): *MCPFNS

ojob:
  opacks      :
  - openaf     : 20250915
  - oJob-common: 20250914
  catch       : printErrnl("[" + job.name + "] "); $err(exception, __, __, job.exec)
  logToConsole: false
  argsFromEnvs: true
  daemon      : true

include:
- oJobMCP.yaml

jobs:
- name : Init file service
  check:
    in:
      basePath: isString
  exec : | #js
    global.basePath = args.basePath
    if (!io.fileExists(global.basePath)) {
      throw "Base path does not exist: " + global.basePath
    }

- name : Read File
  check:
    in:
      filename: isString
  exec : | #js
    var fullPath = global.basePath + "/" + args.filename
    if (!io.fileExists(fullPath)) {
      return "[ERROR] File not found: " + args.filename
    }
    
    try {
      return io.readFileString(fullPath)
    } catch(e) {
      return "[ERROR] Could not read file: " + e.message
    }
```

## Conclusion

Following this guide, you can create robust MCP servers that work in both STDIO and HTTP modes. Remember to:

1. Follow the established patterns from existing MCPs
2. Implement proper error handling and validation
3. Use descriptive metadata for tools
4. Test both STDIO and HTTP modes thoroughly
5. Include proper cleanup procedures

For more examples, refer to the existing MCP implementations in this directory.
