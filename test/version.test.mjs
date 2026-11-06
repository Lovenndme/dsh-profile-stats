import assert from 'node:assert/strict'
import test from 'node:test'

import { compareVersions, isRegistrySpec } from '../index.js'

test('compareVersions：主版本 / 次版本 / 补丁号', () => {
  assert.equal(compareVersions('2.4.13', '2.4.13'), 0)
  assert.equal(compareVersions('2.4.13', '2.4.9'), 1, '按数字比，不按字符串比')
  assert.equal(compareVersions('2.4.9', '2.4.13'), -1)
  assert.equal(compareVersions('2.5.0', '2.4.99'), 1)
  assert.equal(compareVersions('3.0.0', '2.99.99'), 1)
  assert.equal(compareVersions('0.0.1', '0.0.0'), 1)
})

test('compareVersions：正式版高于同号预发布版', () => {
  assert.equal(compareVersions('0.2.1', '0.2.1-rc.5'), 1)
  assert.equal(compareVersions('0.2.1-rc.5', '0.2.1'), -1)
  assert.equal(compareVersions('0.2.1-rc.5', '0.2.1-rc.5'), 0)
})

test('compareVersions：预发布号按数字比较（rc.10 比 rc.5 新）', () => {
  assert.equal(compareVersions('0.2.1-rc.10', '0.2.1-rc.5'), 1)
  assert.equal(compareVersions('0.2.1-rc.5', '0.2.1-rc.10'), -1)
  assert.equal(compareVersions('1.0.0-beta.2', '1.0.0-beta.10'), -1)
  // 字母序的预发布标识按字典序（semver 规定）
  assert.equal(compareVersions('1.0.0-alpha', '1.0.0-beta'), -1)
  assert.equal(compareVersions('1.0.0-beta', '1.0.0-alpha'), 1)
})

test('compareVersions：字段数不同的预发布（alpha < alpha.1）', () => {
  assert.equal(compareVersions('1.0.0-alpha.1', '1.0.0-alpha'), 1)
  assert.equal(compareVersions('1.0.0-alpha', '1.0.0-alpha.1'), -1)
})

test('compareVersions：容忍构建元数据与空值', () => {
  assert.equal(compareVersions('2.4.13+build.7', '2.4.13'), 0, '构建元数据不参与比较')
  assert.equal(compareVersions('', '0.0.0'), 0)
  assert.equal(compareVersions('1.2', '1.2.0'), 0)
})

test('isRegistrySpec：只认 npm registry 依赖', () => {
  for (const spec of [
    'dsh-profile-stats',
    'dsh-profile-stats@2.4.13',
    'dsh-profile-stats@^2.4.0',
    'dsh-profile-stats@latest',
    '@scope/name',
    '@scope/name@1.0.0',
    'some.pkg',
  ]) {
    assert.equal(isRegistrySpec(spec), true, spec)
  }
})

test('isRegistrySpec：本地 / git / 链接一律不算（升级要重装，不能自作主张）', () => {
  for (const spec of [
    '',
    null,
    undefined,
    'file:../dsh-profile-stats',
    'link:../dsh-profile-stats',
    'portal:./x',
    'workspace:*',
    'git+https://github.com/Lovenndme/dsh-profile-stats.git',
    'git:github.com/Lovenndme/dsh-profile-stats',
    'github:Lovenndme/dsh-profile-stats',
    'https://example.com/pkg.tgz',
    'ssh://git@example.com/pkg.git',
    'C:\\Users\\lenovo\\pkg',
    '/usr/local/pkg',
    './local',
    '../local',
  ]) {
    assert.equal(isRegistrySpec(spec), false, String(spec))
  }
})
