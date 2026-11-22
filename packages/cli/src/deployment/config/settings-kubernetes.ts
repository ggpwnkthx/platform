import { aDomain, aPort, aSubDomain, aUrl, anHttpsUrl, serviceName } from './checks.ts'
import { aSiteFolder } from './site.ts'
import { siteChoices } from './choices.ts'
import type { Setting } from './setting.ts'

/** The settings of a Kubernetes deployment. */
export function settingsKubernetes(): Setting[] {
  return [
    {
      name: 'PLATFORM_DOMAIN',
      note: 'The domain this deployment is named by: the services answer on it',
      question: 'Domain of the deployment',
      // A deployment needs a name of its own: the ingress serves TLS under it.
      check: aDomain,
    },
    {
      name: 'PLATFORM_IDP_HOST',
      note: 'The sub-domain Dex, the issuer, answers on',
      question: 'Sub-domain for Dex, the issuer',
      fallback: 'idp',
      check: aSubDomain,
    },
    {
      name: 'PLATFORM_API_HOST',
      note: 'The sub-domain the relay, the API, answers on',
      question: 'Sub-domain for the relay, the API',
      fallback: 'api',
      check: aSubDomain,
    },
    {
      name: 'PLATFORM_DB_HOST',
      note: 'The sub-domain PostgreSQL answers on',
      question: 'Sub-domain for PostgreSQL',
      fallback: 'db',
      check: aSubDomain,
    },
    {
      name: 'PLATFORM_IMAGE',
      note: 'The relay image, in your registry',
      question: 'Relay image, in your registry',
    },
    {
      name: 'PUBLIC_URL',
      note: 'The address of the site: if one already exists, give its full URL; leave it empty and one will be deployed from a folder',
      question: 'URL of your site (empty to deploy one from a folder)',
      // Asked once: a deployment that has chosen where its site goes has answered it.
      when: (answers) => !answers.PLATFORM_APP_HOST && !answers.PLATFORM_SITE,
      // An empty answer means a site is deployed, and its address is worked out below.
      fallback: () => '',
      check: anHttpsUrl,
    },
    {
      name: 'PLATFORM_SITE_URL',
      note: 'The address the site is deployed on',
      // Only when a site is deployed: one that already exists has its own address.
      when: (answers) => !answers.PUBLIC_URL,
      // The site's address is made of the domain and the sub-domain it is deployed on.
      follows: (answers) => {
        const app = answers.PLATFORM_APP_HOST
        const domain = answers.PLATFORM_DOMAIN
        return app && domain ? `https://${app}.${domain}` : undefined
      },
    },
    {
      name: 'PLATFORM_SITE',
      note: 'The folder of the site to deploy, the one that holds platform.json: any folder, named from the root of the checkout or in full',
      question: 'Folder of the site to deploy',
      // Only asked when there is no site that already exists.
      when: (answers) => !answers.PUBLIC_URL,
      // Empty means the platform's own interface, which is no folder's.
      fallback: () => '',
      check: aSiteFolder,
      choices: siteChoices,
    },
    {
      name: 'PLATFORM_APP_HOST',
      note: 'The sub-domain the site is deployed on',
      question: 'Sub-domain for the site',
      // Only asked when there is no site that already exists.
      when: (answers) => !answers.PUBLIC_URL,
      fallback: 'app',
      check: aSubDomain,
    },
    {
      name: 'OIDC_ISSUER',
      note: 'The issuer people sign in through: your Dex',
      follows: (answers) => {
        const name = serviceName(answers, 'PLATFORM_IDP_HOST')
        return name ? `https://${name}` : undefined
      },
      check: anHttpsUrl,
    },
    {
      name: 'PLATFORM_RELAY_URL',
      note: 'The address the pages open their database sessions through',
      follows: (answers) => {
        const name = serviceName(answers, 'PLATFORM_API_HOST')
        return name ? `wss://${name}` : undefined
      },
      check: aUrl,
    },
    {
      name: 'DATABASE_HOST',
      note: 'Where PostgreSQL is: its own sub-domain',
      follows: (answers) => serviceName(answers, 'PLATFORM_DB_HOST'),
    },

    {
      name: 'DATABASE_PORT',
      note: 'The port PostgreSQL listens on',
      question: 'Port PostgreSQL listens on',
      fallback: '5432',
      check: aPort,
    },
  ]
}
