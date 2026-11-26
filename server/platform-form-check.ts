import { isDeepStrictEqual } from 'node:util'
import type { DataDocument } from '../src/jingshan/types.ts'
import { checkFormRowChanges, isPlatformFormDataset } from '../src/jingshan/platform-forms.ts'

export function checkChangedFormRecords(next:DataDocument, previous:DataDocument) {
  for (const dataset of next.datasets.filter(isPlatformFormDataset)) {
    const prior = previous.datasets.find(item => item.id === dataset.id)
    if (prior?.formSchema && dataset.formSchema) {
      for (const field of prior.formSchema.fields) {
        const nextField = dataset.formSchema.fields.find(item => item.key === field.key)
        if (nextField?.type !== field.type && dataset.features.some(row => row.properties[field.key] != null))
          throw new Error('字段「'+field.label+'」仍有填报值。请先清理记录后再移除字段或修改类型')
      }
    }
    checkFormRowChanges(dataset,prior,next.datasets,isDeepStrictEqual)
  }
}
