import * as os from 'os';
import * as tl from 'azure-pipelines-task-lib/task';

import { HttpClient }  from 'typed-rest-client/HttpClient';
import { IHeaders, IRequestOptions } from 'typed-rest-client/Interfaces';

import { NormalizeRegistry } from './npmrcparser';
import * as util from '../util';
import * as locationUtil from '../locationUtilities';

export interface INpmRegistry {
    url: string;
    auth: string;
    authOnly: boolean;
}

export class NpmRegistry implements INpmRegistry {
    public url: string;
    public auth: string;
    public authOnly: boolean;

    constructor(url: string, auth: string, authOnly?: boolean) {
        this.url = url;
        this.auth = auth;
        this.authOnly = authOnly || false;
    }

    /** Return NpmRegistry with masked auth from Service Endpoint. */
    public static async FromServiceEndpoint(endpointId: string, authOnly?: boolean): Promise<NpmRegistry> {
        const lineEnd = os.EOL;
        let endpointAuth: tl.EndpointAuthorization;
        let url: string;
        let nerfed: string;
        let auth: string;
        let username: string;
        let password: string;
        let email: string;
        let password64: string;
        let isVstsTokenAuth: boolean = false;
        try {
            endpointAuth = tl.getEndpointAuthorization(endpointId, false);
        } catch (exception) {
            throw new Error(tl.loc('ServiceEndpointNotDefined'));
        }

        try {
            url = NormalizeRegistry(tl.getEndpointUrl(endpointId, false));

            // To the reader, this could be optimized here but it is broken out for readability
            if (endpointAuth.scheme === 'Token') {
                isVstsTokenAuth = await NpmRegistry.isEndpointInternal(url);
            }
            nerfed = util.toNerfDart(url);
        } catch (exception) {
            throw new Error(tl.loc('ServiceEndpointUrlNotDefined'));
        }

        switch (endpointAuth.scheme) {
            case 'UsernamePassword':
                username = endpointAuth.parameters['username'];
                password = endpointAuth.parameters['password'];
                email = username; // npm needs an email to be set in order to publish, this is ignored on npmjs
                password64 = Buffer.from(password).toString('base64');

                auth = nerfed + ':username=' + username + lineEnd;
                auth += nerfed + ':_password=' + password64 + lineEnd;
                auth += nerfed + ':email=' + email + lineEnd;
                break;
            case 'Token':
                const apitoken = endpointAuth.parameters['apitoken'];
                tl.setSecret(apitoken);
                if (!isVstsTokenAuth){
                    // Use Bearer auth as it was intended.
                    auth = nerfed + ':_authToken=' + apitoken + lineEnd;
                } else {
                    // Azure DevOps does not support PATs+Bearer only JWTs+Bearer
                    email = 'VssEmail';
                    username = 'VssToken';
                    password64 = Buffer.from(apitoken).toString('base64');

                    auth = nerfed + ':username=' + username + lineEnd;
                    auth += nerfed + ':_password=' + password64 + lineEnd;
                    auth += nerfed + ':email=' + email + lineEnd;
                }
                break;
        }
        tl.setSecret(password);
        tl.setSecret(password64);

        auth += nerfed + ':always-auth=true';
        return new NpmRegistry(url, auth, authOnly);
    }

    // make a request to the endpoint uri, and take a look at the response header to
    // determine whether this is our service, or an external service.
    private static async isEndpointInternal(endpointUri: string): Promise<boolean> {
        let requestOptions: IRequestOptions;
        try {
            const proxy = tl.getHttpProxyConfiguration();
            requestOptions = proxy ? { proxy } : {};
        } catch (error) {
            tl.debug('unable to determine proxy configuration: ' + error);
            requestOptions = {};
        }

        const headers: IHeaders = {};
        headers['X-TFS-FedAuthRedirect'] = 'Suppress';

        const endpointClient = new HttpClient(tl.getVariable('AZURE_HTTP_USER_AGENT'), null, requestOptions);
        
        return new Promise<boolean>((resolve, reject) => {
            try {
                endpointClient.get(endpointUri, headers).then((res) => {
                    if (res.message.statusCode) {
                        // Define event listener functions
                        const onData = () => {};
                        const onEnd = () => {
                            cleanup();
                            resolve (res.message.rawHeaders !== null && res.message.rawHeaders.some(t => t.toLowerCase().indexOf('x-tfs') >= 0 || t.toLowerCase().indexOf('x-vss') >= 0));
                        };
                        const onError = (err) => {
                            cleanup();
                            throw(err);
                        };

                        const cleanup = () => {
                            res.message.removeListener('data', onData);
                            res.message.removeListener('end', onEnd);
                            res.message.removeListener('error', onError);
                        };

                        // Attach event listeners
                        res.message.on('data', onData);
                        res.message.once('end', onEnd);
                        res.message.once('error', onError);
                    } else {
                        throw new Error('No status code received from the response');
                    }
                });
            } catch (error) {
                tl.debug(error);
                reject(false);
            }
        });
    }

    public static async FromFeedId(packagingUri: string, feedId: string, project: string, authOnly?: boolean, useSession?: boolean): Promise<NpmRegistry> {
        const url = NormalizeRegistry(
            await locationUtil.getFeedRegistryUrl(packagingUri, locationUtil.RegistryType.npm, feedId, project, null, useSession));
        return NpmRegistry.FromUrl(url, authOnly);
    }

    public static FromUrl(url: string, authOnly?: boolean): NpmRegistry {
        const nerfed = util.toNerfDart(url);
        const auth = `${nerfed}:_authToken=${locationUtil.getSystemAccessToken()}`;

        return new NpmRegistry(url, auth, authOnly);
    }
}
