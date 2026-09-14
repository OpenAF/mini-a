// Evaluation helper: validate positions against exact raw Markdown, not its body.
exports.check = function(raw, evidence) {
  raw=String(raw)
  var reasons=[], start=evidence.charStart, end=evidence.charEnd
  var positioned=isNumber(start) && isNumber(end) && isFinite(start) && isFinite(end) && start===Math.floor(start) && end===Math.floor(end) && start>=0 && end>start && end<=raw.length
  if(!positioned)reasons.push("missing-or-invalid-character-range")
  var textCorrect=positioned && raw.substring(start,end)===evidence.content
  if(!textCorrect)reasons.push("text-mismatch")
  if(evidence.revision!==sha1(raw))reasons.push("revision-mismatch-or-missing")
  if(positioned) {
    var first=raw.substring(0,start).split("\n").length, last=raw.substring(0,end-1).split("\n").length
    if(evidence.lineStart!==first || evidence.lineEnd!==last)reasons.push("raw-line-range-mismatch")
    var ref=evidence.passage
    if(!isMap(ref) || ref.revision!==evidence.revision || ref.page!==evidence.path || ref.charStart!==start || ref.charEnd!==end || ref.startLine!==first || ref.endLine!==last)reasons.push("passage-reference-mismatch-or-missing")
  }
  return {correct:reasons.length===0,textCorrect:textCorrect,reasons:reasons}
}
