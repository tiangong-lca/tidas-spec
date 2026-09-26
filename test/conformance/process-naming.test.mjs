import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import YAML from 'yaml';
import { repositoryAuthoredAssetPaths } from '../../scripts/spec/lib/inventory.mjs';
import { hashCanonicalJson, sha256Hex } from '../../scripts/spec/lib/core.mjs';

const read = (relative) => readFileSync(new URL(`../../${relative}`, import.meta.url), 'utf8');
const processMethod = YAML.parse(read('assets/tidas/methodologies/tidas_processes.yaml'));
const flowMethod = YAML.parse(read('assets/tidas/methodologies/tidas_flows.yaml'));
const processName = processMethod.processDataSet.processInformation.dataSetInformation.name;
const flowName = flowMethod.flowDataSet.flowInformation.dataSetInformation.name;
const rules = JSON.parse(read('assets/tidas/rules/public-rules.v1.json')).rules;
const baseRule = rules.find(({ id }) => id === 'tidas.process.name.base-name.align-reference-flow');
const qualifierRule = rules.find(({ id }) => id === 'tidas.process.name.qualifiers.structured');
const languageRule = (field, language) => field['<rules>'].find((entry) => entry.language === language);
const text = (field, language) => JSON.stringify(languageRule(field, language));

// These are editorial conformance checks on the public specification. They do
// not parse arbitrary names, certify scientific evidence or choose gate policy.
test('four name segments retain bilingual guidance and field-scoped reference identity', () => {
  assert.deepEqual(Object.keys(processName), [
    'baseName', 'treatmentStandardsRoutes', 'mixAndLocationTypes', 'functionalUnitFlowProperties',
  ]);
  for (const [field, value] of Object.entries(processName)) {
    assert.deepEqual(value['<rules>'].map(({ language }) => language).sort(), ['en', 'zh'], field);
  }
  assert.equal(baseRule.normative_level, 'requirement');
  assert.match(text(processName.baseName, 'en'), /Single reference flow: use that exact reference Flow's baseName/);
  assert.match(text(processName.baseName, 'zh'), /单一参考流：各对应语言的baseName沿用该精确参考Flow/);
  assert.match(text(processName.baseName, 'en'), /Multiple reference flows: start with the technology or plant descriptor/);
  assert.match(text(processName.baseName, 'zh'), /多参考流：以技术或装置描述开头/);
  assert.match(baseRule.applicability.scope, /regardless of publication status/);
  assert.match(baseRule.applicability.scope, /ILCD Rule 20.*full-name alignment/);
});

test('numeric grades stay technical while material specifications have their own basis', () => {
  for (const language of ['en', 'zh']) {
    assert.match(text(processName.treatmentStandardsRoutes, language), /C30.*S355/);
    assert.match(text(processName.treatmentStandardsRoutes, language), /functionalUnitFlowProperties/);
    const examples = languageRule(processName.functionalUnitFlowProperties, language).examples;
    assert.ok(examples.some((value) => /10 mg\/kg/.test(value)), language);
    assert.ok(examples.some((value) => /30 %/.test(value)), language);
    assert.ok(!examples.some((value) => /^1 (kg|kWh)$|1 kWh = 3\.6 MJ|C30|S355/.test(value)), language);
  }
  assert.match(text(processName.functionalUnitFlowProperties, 'en'), /denominator and material boundary.*supplier.*certificate/);
  assert.match(text(processName.functionalUnitFlowProperties, 'zh'), /分母与材料边界.*供方采购份额.*证书覆盖份额/);
  assert.match(text(processName.functionalUnitFlowProperties, 'en'), /Equipment capacity, processing duration and loss rate.*unless they define the delivered service/);
  assert.match(text(processName.functionalUnitFlowProperties, 'zh'), /设备容量、工艺时长和损耗率只有在其定义交付服务/);
  assert.match(text(processName.functionalUnitFlowProperties, 'en'), /functional unit.*footprint result.*supplier weights/);
  assert.match(text(processName.functionalUnitFlowProperties, 'zh'), /功能单位数量.*足迹结果.*供方权重/);
});

test('Flow and Process distinguish mix scope from technology and delivery in both languages', () => {
  for (const name of [processName, flowName]) {
    const en = text(name.mixAndLocationTypes, 'en');
    const zh = text(name.mixAndLocationTypes, 'zh');
    assert.match(en, /production mix.*market consumption mix.*enterprise procurement mix/i);
    assert.match(en, /TIDAS extension.*original ILCD enumeration/);
    assert.match(en, /not a mutually exclusive mix class/);
    assert.match(zh, /生产组合.*市场消费组合.*企业采购组合/);
    assert.match(zh, /不是ILCD原有枚举/);
    assert.match(zh, /不是互斥的组合类别/);
    assert.match(en, /loss proxy.*mapping adapter.*does not establish.*consumption mix/);
    assert.match(zh, /损耗代理.*映射适配过程.*不能证明消费组合/);
    assert.ok(languageRule(name.mixAndLocationTypes, 'en').examples.includes('To user receiving terminal'));
    assert.ok(languageRule(name.mixAndLocationTypes, 'zh').examples.includes('至用户接收端'));
  }
  assert.match(text(flowName.mixAndLocationTypes, 'en'), /do not copy an individual Process route/);
  assert.match(text(flowName.mixAndLocationTypes, 'zh'), /不为区分Process而把某个Process路线/);
});

test('arrival and departure meanings never certify inventory completeness', () => {
  for (const name of [processName, flowName]) {
    assert.match(text(name.mixAndLocationTypes, 'en'), /arrival.*before.*subsequent processing/);
    assert.match(text(name.mixAndLocationTypes, 'en'), /departure or availability.*after the represented processing/);
    assert.match(text(name.mixAndLocationTypes, 'en'), /not (proof of )?complete inventory coverage/);
    assert.match(text(name.mixAndLocationTypes, 'zh'), /到达.*后续处理/);
    assert.match(text(name.mixAndLocationTypes, 'zh'), /处理完成后.*离开或可供交付/);
    assert.match(text(name.mixAndLocationTypes, 'zh'), /不证明清单覆盖完整/);
  }
});

test('contractual attributes do not establish physical supply or zero impact', () => {
  for (const name of [processName, flowName]) {
    assert.match(text(name.mixAndLocationTypes, 'en'), /physical supply composition.*contractual or attribute accounting/);
    assert.match(text(name.mixAndLocationTypes, 'en'), /certificate alone.*neither physical generation technology nor zero impact/);
    assert.match(text(name.mixAndLocationTypes, 'zh'), /物理供应组合与合同或属性核算/);
    assert.match(text(name.mixAndLocationTypes, 'zh'), /单凭证书既不能证明实际发电技术，也不能证明零影响/);
  }
});

test('whole-Model names and per-language information remain explicit requirements of the guidance', () => {
  assert.match(text(processName.mixAndLocationTypes, 'en'), /resulting Process retains the reviewed Model name, not a narrower final Process name/);
  assert.match(text(processName.mixAndLocationTypes, 'zh'), /结果Process继承经审查的Model名称，不采用范围更窄的最终Process名称/);
  assert.match(text(processName.baseName, 'en'), /every authored language.*deliberate removal/);
  assert.match(text(processName.baseName, 'zh'), /每一种已编写语言.*有意删除须说明依据/);
  assert.match(text(processName.mixAndLocationTypes, 'en'), /graph or node label alone does not establish missing upstream/);
  assert.match(text(processName.mixAndLocationTypes, 'zh'), /Model图或节点名称本身不能证明缺失的上游/);
});

test('public conformance cases cover the new distinctions without adding execution policy', () => {
  assert.equal(qualifierRule.normative_level, 'recommendation');
  assert.deepEqual(qualifierRule.source_refs.map(({ path }) => path.split('.').at(-2)).sort(), [
    'functionalUnitFlowProperties', 'mixAndLocationTypes', 'treatmentStandardsRoutes',
  ]);
  const positive = qualifierRule.cases.positive.join('\n');
  const negative = qualifierRule.cases.negative.join('\n');
  for (const term of [/technology-specific production mix/, /delivery-only electricity adapter/, /enterprise procurement mix/, /refinery receiving terminal/, /S355/, /30 % recycled material/]) {
    assert.match(positive, term);
  }
  for (const term of [/grid-loss proxy/, /original ILCD class/, /complete cradle-to-node/, /certificate/, /supplier procurement share/, /footprint result/]) {
    assert.match(negative, term);
  }
  for (const rule of [baseRule, qualifierRule]) {
    for (const key of ['severity', 'default_blocker', 'phase', 'authorization']) assert.ok(!(key in rule));
  }
});

test('Flow methodology supersession keeps the original hash and independently binds remaining imports', () => {
  const importText = read('source-import.yaml');
  const imported = YAML.parse(importText);
  const flowPath = 'assets/tidas/methodologies/tidas_flows.yaml';
  assert.ok(imported.excludedSourcePaths.includes(flowPath));
  assert.ok(!imported.files.some(({ packagePath }) => packagePath === flowPath));
  assert.ok(repositoryAuthoredAssetPaths().includes(flowPath));
  assert.match(importText, /4a389d060f5c901b7c11625675948c0152df95ad33bedc87eca0f93341038d6d/);
  const baseline = JSON.parse(read('reviewed-baseline.json'));
  assert.equal(baseline.fileCount, 32);
  assert.equal(baseline.sourceFilesSha256, hashCanonicalJson(Object.fromEntries(imported.files.map((entry) => [entry.sourcePath, entry.sha256]))));
  const hashes = Object.fromEntries(imported.files.map(({ packagePath, sha256 }) => {
    const actual = sha256Hex(readFileSync(new URL(`../../${packagePath}`, import.meta.url)));
    assert.equal(actual, sha256, packagePath);
    return [packagePath, actual];
  }));
  assert.equal(baseline.packageFilesSha256, hashCanonicalJson(hashes));
});
