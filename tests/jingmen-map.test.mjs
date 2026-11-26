import assert from 'node:assert/strict'
import test from 'node:test'
import {describeGatewayXml, dscHeaders} from '../server/jingmen-map.ts'

test('签名遵循平台 SignUtil 的带时间戳签名规则，Secret 仅参与服务端摘要计算',()=>{
  const headers=dscHeaders('demo-app','demo-secret',1000999)
  assert.equal(headers['DSC-APP-SIGN'],'E427199031704EE285654E636DC94AC4')
  assert.equal(headers['DSC-APP-TIMESTAMP'],'1000')
  assert.equal(headers['DSC-APP-KEY'],'demo-app')
  assert.ok(!JSON.stringify(headers).includes('demo-secret'))
})

test('HTTP 200 的授权错误仍标为需要授权，登录页和 OGC 异常不能当作地图数据',()=>{
  const read=text=>describeGatewayXml(Buffer.from(text))
  assert.throws(()=>read('<BusinessMessage><code>100107</code><success>false</success><data/></BusinessMessage>'),
    e=>e.state==='auth'&&e.message.includes('100107'))
  assert.throws(()=>read('<html/>'))
  assert.throws(()=>read('<ows:ExceptionReport xmlns:ows="urn:ows"/>'))
  assert.throws(()=>read('<!DOCTYPE x><x/>'))
  assert.throws(()=>read('<BusinessMessage>'))
  assert.match(read('<BusinessMessage><success>true</success><data>&lt;xml/&gt;</data></BusinessMessage>'),/成功/)
  assert.match(read('<wms:WMS_Capabilities xmlns:wms="urn:wms"/>'),/WMS/)
})

