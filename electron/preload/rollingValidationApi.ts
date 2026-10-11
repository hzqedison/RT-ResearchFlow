import { ipcRenderer } from 'electron'
import type { ValidationRequest, ValidationResult, ValidationStudy } from '../shared/rollingValidation'
export const rollingValidationApi = {
  list: () => ipcRenderer.invoke('rollingValidation:list') as Promise<ValidationResult<Array<Pick<ValidationStudy, 'id' | 'createdAt' | 'status' | 'reportsCompleted' | 'reportsPlanned'>>>>,
  get: (id: string) => ipcRenderer.invoke('rollingValidation:get', id) as Promise<ValidationResult<ValidationStudy>>,
  prepare: (request: ValidationRequest) => ipcRenderer.invoke('rollingValidation:prepare', request) as Promise<ValidationResult<ValidationStudy>>,
  advance: (id: string) => ipcRenderer.invoke('rollingValidation:advance', id) as Promise<ValidationResult<ValidationStudy>>,
}
