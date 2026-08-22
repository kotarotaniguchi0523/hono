import type { commentsApp, postsApp, projectsApp, teamsApp, usersApp } from 'rpc-benchmark-domains'
import { hc } from '../../../src/client/index.js'
import type { InferRequestType, InferResponseType } from '../../../src/client/index.js'

const usersClient = hc<typeof usersApp>('/')
const postsClient = hc<typeof postsApp>('/')
const commentsClient = hc<typeof commentsApp>('/')
const teamsClient = hc<typeof teamsApp>('/')
const projectsClient = hc<typeof projectsApp>('/')

const consumeUsers = async () => {
  const endpoint = usersClient.representative[':id'].$get
  type Request = InferRequestType<typeof endpoint>
  type Response = InferResponseType<typeof endpoint>
  const request: Request = { param: { id: '1' }, query: { include: 'summary' } }
  const response = await endpoint(request)
  const body = await response.json()
  return body satisfies Response
}

const consumePosts = async () => {
  const endpoint = postsClient.representative[':id'].$get
  type Request = InferRequestType<typeof endpoint>
  type Response = InferResponseType<typeof endpoint>
  const request: Request = { param: { id: '1' }, query: { include: 'summary' } }
  const response = await endpoint(request)
  const body = await response.json()
  return body satisfies Response
}

const consumeComments = async () => {
  const endpoint = commentsClient.representative[':id'].$get
  type Request = InferRequestType<typeof endpoint>
  type Response = InferResponseType<typeof endpoint>
  const request: Request = { param: { id: '1' }, query: { include: 'summary' } }
  const response = await endpoint(request)
  const body = await response.json()
  return body satisfies Response
}

const consumeTeams = async () => {
  const endpoint = teamsClient.representative[':id'].$get
  type Request = InferRequestType<typeof endpoint>
  type Response = InferResponseType<typeof endpoint>
  const request: Request = { param: { id: '1' }, query: { include: 'summary' } }
  const response = await endpoint(request)
  const body = await response.json()
  return body satisfies Response
}

const consumeProjects = async () => {
  const endpoint = projectsClient.representative[':id'].$get
  type Request = InferRequestType<typeof endpoint>
  type Response = InferResponseType<typeof endpoint>
  const request: Request = { param: { id: '1' }, query: { include: 'summary' } }
  const response = await endpoint(request)
  const body = await response.json()
  return body satisfies Response
}

export const splitDomainConsumers = [
  consumeUsers,
  consumePosts,
  consumeComments,
  consumeTeams,
  consumeProjects,
]
