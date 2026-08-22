import type { app } from 'rpc-benchmark-parent'
import { hc } from '../../../src/client/index.js'
import type { InferRequestType, InferResponseType } from '../../../src/client/index.js'

const client = hc<typeof app>('/')

const consumeUsers = async () => {
  const endpoint = client.users.representative[':id'].$get
  type Request = InferRequestType<typeof endpoint>
  type Response = InferResponseType<typeof endpoint>
  const request: Request = { param: { id: '1' }, query: { include: 'summary' } }
  const response = await endpoint(request)
  const body = await response.json()
  return body satisfies Response
}

const consumePosts = async () => {
  const endpoint = client.posts.representative[':id'].$get
  type Request = InferRequestType<typeof endpoint>
  type Response = InferResponseType<typeof endpoint>
  const request: Request = { param: { id: '1' }, query: { include: 'summary' } }
  const response = await endpoint(request)
  const body = await response.json()
  return body satisfies Response
}

const consumeComments = async () => {
  const endpoint = client.comments.representative[':id'].$get
  type Request = InferRequestType<typeof endpoint>
  type Response = InferResponseType<typeof endpoint>
  const request: Request = { param: { id: '1' }, query: { include: 'summary' } }
  const response = await endpoint(request)
  const body = await response.json()
  return body satisfies Response
}

const consumeTeams = async () => {
  const endpoint = client.teams.representative[':id'].$get
  type Request = InferRequestType<typeof endpoint>
  type Response = InferResponseType<typeof endpoint>
  const request: Request = { param: { id: '1' }, query: { include: 'summary' } }
  const response = await endpoint(request)
  const body = await response.json()
  return body satisfies Response
}

const consumeProjects = async () => {
  const endpoint = client.projects.representative[':id'].$get
  type Request = InferRequestType<typeof endpoint>
  type Response = InferResponseType<typeof endpoint>
  const request: Request = { param: { id: '1' }, query: { include: 'summary' } }
  const response = await endpoint(request)
  const body = await response.json()
  return body satisfies Response
}

export const aggregateClientConsumers = [
  consumeUsers,
  consumePosts,
  consumeComments,
  consumeTeams,
  consumeProjects,
]
