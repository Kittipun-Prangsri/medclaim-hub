import test from 'node:test';import assert from 'node:assert/strict';
import ruleset from '../src/rules/ucs-opd-v1.json' assert {type:'json'};
import {RulesEngine} from '../src/services/RulesEngine.js';
const engine=new RulesEngine(ruleset);
test('valid UCS visit has no issues',()=>{assert.deepEqual(engine.validate({citizenId:'1101700203450',mainDiagnosis:'J00',pttype:'01',amount:100,authCode:'A1'}),[])});
test('missing diagnosis blocks the claim',()=>{const issues=engine.validate({citizenId:'1101700203450',mainDiagnosis:'',pttype:'01',amount:100,authCode:'A1'});assert.equal(issues.some(i=>i.ruleId==='UCS-002'&&i.severity==='critical'),true)});
test('missing auth code creates warning',()=>{const issues=engine.validate({citizenId:'1101700203450',mainDiagnosis:'J00',pttype:'01',amount:100,authCode:''});assert.equal(issues.find(i=>i.ruleId==='UCS-005').severity,'warning')});
