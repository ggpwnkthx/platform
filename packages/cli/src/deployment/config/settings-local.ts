import { aDomain, aPort, aSubDomain, aUrl, anAddress, serviceName } from './checks.ts'
import { aSiteFolder } from './site.ts'
import { siteChoices } from './choices.ts'
import type { Setting } from './setting.ts'

/** The settings of the local stack. */
export function settingsLocal(): Setting[] {
  return [
    {
      name: 'PLATFORM_DOMAIN',
      note: 'The domain this deployment is named by: the services answer on it',
      question: 'Domain of the deployment',
      // `localhost` names the local machine: every browser and resolver answers for it.
      fallback: 'localhost',
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
      name: 'PLATFORM_PUBLIC_URL',
      note: 'The address of the site: if one already exists, give its full URL; leave it empty and one will be deployed from a folder',
      question: 'URL of your site (empty to deploy one from a folder)',
      // Asked once: a deployment that has chosen where its site goes has answered it.
      when: (answers) => !answers.PLATFORM_APP_HOST && !answers.PLATFORM_SITE,
      // An empty answer means a site is deployed, and its address is worked out below.
      fallback: () => '',
      check: aUrl,
    },
    {
      name: 'PLATFORM_SITE_URL',
      note: 'The address the site is deployed on',
      // Only when a site is deployed: one that already exists has its own address.
      when: (answers) => !answers.PLATFORM_PUBLIC_URL,
      // The site's address is made of the domain and the sub-domain it is deployed on.
      follows: (answers) => {
        const app = answers.PLATFORM_APP_HOST
        const domain = answers.PLATFORM_DOMAIN
        if (!app || !domain) return undefined
        // A site is served by the stack itself, behind the edge. Without one the site
        // is the development server's, on the port it serves on.
        return answers.PLATFORM_SITE
          ? `http://${app}.${domain}:${answers.EDGE_PORT ?? '8080'}`
          : `http://${app}.${domain}:5173`
      },
    },
    {
      name: 'PLATFORM_SITE',
      note: 'The folder of the site to deploy, the one that holds platform.json: any folder, named from the root of the checkout or in full',
      question: 'Folder of the site to deploy',
      // Only asked when there is no site that already exists.
      when: (answers) => !answers.PLATFORM_PUBLIC_URL,
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
      when: (answers) => !answers.PLATFORM_PUBLIC_URL,
      fallback: 'app',
      check: aSubDomain,
    },
    {
      name: 'EDGE_PORT',
      note: 'The port the edge answers on, on this machine',
      question: 'Port for the edge, on this machine',
      // Not 80: a rootless container cannot bind a port below 1024, and which port the
      // operator's machine answers on is the operator's business.
      fallback: '8080',
      check: aPort,
    },
    {
      name: 'EDGE_TLS_PORT',
      note: 'The port the edge answers TLS on, when it is given a certificate',
      question: 'Port for the edge with TLS',
      fallback: '4433',
      check: aPort,
    },
    {
      name: 'PLATFORM_ISSUER',
      note: 'The issuer people sign in through: your Dex',
      // Dex answers on its own sub-domain, behind the edge: the issuer follows from the
      // domain and the port the edge answers on.
      follows: (answers) => {
        const name = serviceName(answers, 'PLATFORM_IDP_HOST')
        return name && answers.EDGE_PORT ? `http://${name}:${answers.EDGE_PORT}` : undefined
      },
      check: aUrl,
    },
    {
      name: 'OIDC_ISSUER',
      note: 'The issuer the operator signs in through, the same Dex',
      follows: (answers) => answers.PLATFORM_ISSUER,
      check: aUrl,
    },
    {
      name: 'PLATFORM_RELAY_URL',
      note: 'The address the pages open their database sessions through',
      // The relay answers on its own sub-domain, behind the edge: its address follows from
      // the domain and the port the edge answers on.
      follows: (answers) => {
        const name = serviceName(answers, 'PLATFORM_API_HOST')
        return name && answers.EDGE_PORT ? `ws://${name}:${answers.EDGE_PORT}` : undefined
      },
      check: aUrl,
    },
    {
      name: 'DATABASE_HOST',
      note: 'Where PostgreSQL is: its own sub-domain',
      follows: (answers) => serviceName(answers, 'PLATFORM_DB_HOST'),
    },
    {
      name: 'DATABASE_NAME',
      note: 'The database the platform is installed in',
      // The name the platform installs itself under: the same for every deployment.
      follows: () => 'platform',
    },

    {
      name: 'POSTGRES_PORT',
      note: 'The port PostgreSQL answers on',
      question: 'Port for PostgreSQL',
      fallback: '5432',
      check: aPort,
    },
    {
      name: 'DEX_PORT',
      note: 'The port Dex answers on, behind the edge',
      question: 'Port for Dex, behind the edge',
      fallback: '5556',
      check: aPort,
    },
    {
      name: 'RELAY_PORT',
      note: 'The port the relay answers on, behind the edge',
      question: 'Port for the relay, behind the edge',
      fallback: '8081',
      check: aPort,
    },
    {
      name: 'PLATFORM_ADMIN',
      note: 'The break-glass administrator: the address Dex knows them by, which is their role in PostgreSQL',
      question: 'Administrator, as an address',
      // The deployment's own, on its own domain: not an address on somebody else's.
      fallback: (answers) => `admin@${answers.PLATFORM_DOMAIN ?? 'localhost'}`,
      check: anAddress,
    },
    {
      name: 'PLATFORM_ADMIN_PASSWORD',
      note: 'The password Dex asks the break-glass administrator for',
      secret: true,
    },
  ]
}
