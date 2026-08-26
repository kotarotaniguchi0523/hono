import { hc } from '../../../src/client/index.js'
import type { InferRequestType, InferResponseType } from '../../../src/client/index.js'
import type { ExtractSchema } from '../../../src/types.js'
import type {
  commentsApp,
  postsApp,
  projectsApp,
  teamsApp,
  usersApp,
} from '../generated/domains/index.js'
import type { app } from '../generated/parent.js'

type Assert<T extends true> = T
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false
type Assignable<A, B> = [A] extends [B] ? true : false
type IsAny<T> = 0 extends 1 & T ? true : false
type IsNever<T> = [T] extends [never] ? true : false
type IsUsable<T> = IsAny<T> extends true ? false : IsNever<T> extends true ? false : true
type OutputOf<Endpoint> = Endpoint extends { output: infer Output } ? Output : never
type ExpectedRepresentativeRequest = {
  param: { id: string }
  query: { include: 'summary' | 'details' }
}
type ExpectedRepresentativeResponse<Domain extends string> =
  | { error: `${Domain} not found` }
  | {
      domain: Domain
      id: string
      include: 'summary' | 'details'
      requestId: string
    }

export const splitUsers = hc<typeof usersApp>('/').representative[':id'].$get
export const splitPosts = hc<typeof postsApp>('/').representative[':id'].$get
export const splitComments = hc<typeof commentsApp>('/').representative[':id'].$get
export const splitTeams = hc<typeof teamsApp>('/').representative[':id'].$get
export const splitProjects = hc<typeof projectsApp>('/').representative[':id'].$get
export const splitUsersPost = hc<typeof usersApp>('/').representative.$post

const aggregateClient = hc<typeof app>('/')
export const aggregateUsers = aggregateClient.users.representative[':id'].$get
export const aggregatePosts = aggregateClient.posts.representative[':id'].$get
export const aggregateComments = aggregateClient.comments.representative[':id'].$get
export const aggregateTeams = aggregateClient.teams.representative[':id'].$get
export const aggregateProjects = aggregateClient.projects.representative[':id'].$get
export const aggregateUsersPost = aggregateClient.users.representative.$post

type SplitUsersRequest = InferRequestType<typeof splitUsers>
type SplitPostsRequest = InferRequestType<typeof splitPosts>
type SplitCommentsRequest = InferRequestType<typeof splitComments>
type SplitTeamsRequest = InferRequestType<typeof splitTeams>
type SplitProjectsRequest = InferRequestType<typeof splitProjects>
type AggregateUsersRequest = InferRequestType<typeof aggregateUsers>
type AggregatePostsRequest = InferRequestType<typeof aggregatePosts>
type AggregateCommentsRequest = InferRequestType<typeof aggregateComments>
type AggregateTeamsRequest = InferRequestType<typeof aggregateTeams>
type AggregateProjectsRequest = InferRequestType<typeof aggregateProjects>

type SplitUsersResponse = InferResponseType<typeof splitUsers>
type SplitPostsResponse = InferResponseType<typeof splitPosts>
type SplitCommentsResponse = InferResponseType<typeof splitComments>
type SplitTeamsResponse = InferResponseType<typeof splitTeams>
type SplitProjectsResponse = InferResponseType<typeof splitProjects>
type AggregateUsersResponse = InferResponseType<typeof aggregateUsers>
type AggregatePostsResponse = InferResponseType<typeof aggregatePosts>
type AggregateCommentsResponse = InferResponseType<typeof aggregateComments>
type AggregateTeamsResponse = InferResponseType<typeof aggregateTeams>
type AggregateProjectsResponse = InferResponseType<typeof aggregateProjects>
type SplitUsersPostRequest = InferRequestType<typeof splitUsersPost>
type AggregateUsersPostRequest = InferRequestType<typeof aggregateUsersPost>

type ExpectedPostRequest = { json: { name: string } }

export type ModularRpcContracts = [
  Assert<Assignable<SplitUsersRequest, ExpectedRepresentativeRequest>>,
  Assert<Assignable<SplitPostsRequest, ExpectedRepresentativeRequest>>,
  Assert<Assignable<SplitCommentsRequest, ExpectedRepresentativeRequest>>,
  Assert<Assignable<SplitTeamsRequest, ExpectedRepresentativeRequest>>,
  Assert<Assignable<SplitProjectsRequest, ExpectedRepresentativeRequest>>,
  Assert<Assignable<ExpectedRepresentativeRequest, SplitUsersRequest>>,
  Assert<Assignable<ExpectedRepresentativeRequest, SplitPostsRequest>>,
  Assert<Assignable<ExpectedRepresentativeRequest, SplitCommentsRequest>>,
  Assert<Assignable<ExpectedRepresentativeRequest, SplitTeamsRequest>>,
  Assert<Assignable<ExpectedRepresentativeRequest, SplitProjectsRequest>>,
  Assert<Equal<SplitUsersResponse, ExpectedRepresentativeResponse<'users'>>>,
  Assert<Equal<SplitPostsResponse, ExpectedRepresentativeResponse<'posts'>>>,
  Assert<Equal<SplitCommentsResponse, ExpectedRepresentativeResponse<'comments'>>>,
  Assert<Equal<SplitTeamsResponse, ExpectedRepresentativeResponse<'teams'>>>,
  Assert<Equal<SplitProjectsResponse, ExpectedRepresentativeResponse<'projects'>>>,
  Assert<Assignable<SplitUsersPostRequest, ExpectedPostRequest>>,
  Assert<Assignable<ExpectedPostRequest, SplitUsersPostRequest>>,
  Assert<Equal<SplitUsersPostRequest, AggregateUsersPostRequest>>,
  Assert<Equal<SplitUsersRequest, AggregateUsersRequest>>,
  Assert<Equal<SplitPostsRequest, AggregatePostsRequest>>,
  Assert<Equal<SplitCommentsRequest, AggregateCommentsRequest>>,
  Assert<Equal<SplitTeamsRequest, AggregateTeamsRequest>>,
  Assert<Equal<SplitProjectsRequest, AggregateProjectsRequest>>,
  Assert<Equal<SplitUsersResponse, AggregateUsersResponse>>,
  Assert<Equal<SplitPostsResponse, AggregatePostsResponse>>,
  Assert<Equal<SplitCommentsResponse, AggregateCommentsResponse>>,
  Assert<Equal<SplitTeamsResponse, AggregateTeamsResponse>>,
  Assert<Equal<SplitProjectsResponse, AggregateProjectsResponse>>,
  Assert<IsUsable<SplitUsersRequest>>,
  Assert<IsUsable<SplitPostsRequest>>,
  Assert<IsUsable<SplitCommentsRequest>>,
  Assert<IsUsable<SplitTeamsRequest>>,
  Assert<IsUsable<SplitProjectsRequest>>,
  Assert<IsUsable<AggregateUsersRequest>>,
  Assert<IsUsable<AggregatePostsRequest>>,
  Assert<IsUsable<AggregateCommentsRequest>>,
  Assert<IsUsable<AggregateTeamsRequest>>,
  Assert<IsUsable<AggregateProjectsRequest>>,
  Assert<IsUsable<SplitUsersResponse>>,
  Assert<IsUsable<SplitPostsResponse>>,
  Assert<IsUsable<SplitCommentsResponse>>,
  Assert<IsUsable<SplitTeamsResponse>>,
  Assert<IsUsable<SplitProjectsResponse>>,
  Assert<IsUsable<AggregateUsersResponse>>,
  Assert<IsUsable<AggregatePostsResponse>>,
  Assert<IsUsable<AggregateCommentsResponse>>,
  Assert<IsUsable<AggregateTeamsResponse>>,
  Assert<IsUsable<AggregateProjectsResponse>>,
]

type AppSchema = ExtractSchema<typeof app>
type RepresentativePaths =
  | '/users/representative/:id'
  | '/posts/representative/:id'
  | '/comments/representative/:id'
  | '/teams/representative/:id'
  | '/projects/representative/:id'
type PublicSchemaPath = keyof AppSchema & string
type PublicMethodKeys = {
  [Path in PublicSchemaPath]: keyof AppSchema[Path]
}[PublicSchemaPath]
type V5InternalMethod = '@NOT_FOUND' | '@ERROR' | '$@NOT_FOUND' | '$@ERROR'

export type ExtractSchemaContracts = [
  Assert<Equal<Extract<keyof AppSchema, RepresentativePaths>, RepresentativePaths>>,
  Assert<Equal<Extract<PublicMethodKeys, V5InternalMethod>, never>>,
  Assert<IsUsable<OutputOf<AppSchema['/users/representative/:id']['$get']>>>,
  Assert<IsUsable<OutputOf<AppSchema['/posts/representative/:id']['$get']>>>,
  Assert<IsUsable<OutputOf<AppSchema['/comments/representative/:id']['$get']>>>,
  Assert<IsUsable<OutputOf<AppSchema['/teams/representative/:id']['$get']>>>,
  Assert<IsUsable<OutputOf<AppSchema['/projects/representative/:id']['$get']>>>,
]
