import { expect } from 'chai'
import { mergeStorageMap } from '../src/modules/moduleUtils'

describe('#moduleUtils', () => {
  describe('#mergeStorageMap', () => {
    it('merge item into empty map', () => {
      expect(mergeStorageMap({}, { a: 'val' }))
        .to.eql({ a: 'val' })
    })
    it('merge items', () => {
      expect(mergeStorageMap({ a: 'vala', b: 'valb' }, { a: 'val', c: 'valc' }))
        .to.eql({ a: 'val', b: 'valb', c: 'valc' })
    })
    it('merge storage cells', () => {
      expect(mergeStorageMap({ a: { s1: 's1', s2: 'v2' } }, { a: { s1: 's1', s3: 'v3' } }))
        .to.eql({ a: { s1: 's1', s2: 'v2', s3: 'v3' } })
    })
    it('should prefer root over slots in merged', async () => {
      expect(mergeStorageMap({ a: 'aa1' }, { a: { s1: 's1', s3: 'v3' } }))
        .to.eql({ a: 'aa1' })
    })
    it('should prefer root over slots in validateStorage', async () => {
      expect(mergeStorageMap({ a: { s1: 's1', s3: 'v3' } }, { a: 'aa1' }))
        .to.eql({ a: 'aa1' })
    })
  })
})
