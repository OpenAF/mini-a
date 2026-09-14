ow.loadTest()
var count=0, original=ow.test.assert
ow.test.assert=function(){count++;return original.apply(ow.test,arguments)}
var tests=require("tests/wikiRetrievalV2.js")
for(var run=0;run<2;run++)Object.keys(tests).forEach(function(k){tests[k]()})
print("REPEATED_ASSERTIONS="+count)
