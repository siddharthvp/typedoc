import type { Application } from '../../application';
import * as ts from 'typescript';
import * as shell from 'shelljs';
import { HostLinkResolver } from './hosts';
import { ReflectionKind, SomeReflection } from '../../models';

/**
 * Represents references of reflections to their defining source files.
 */
export interface SourceReference {
    /**
     * The filename of the source file.
     */
    fileName: string;

    /**
     * The number of the line that emitted the declaration. One based.
     */
    line: number;

    /**
     * The column in the line that contains the declaration. Zero based.
     */
    character: number;

    /**
     * URL for displaying the reflection this reference is attached to.
     * May not be set if the source file on does not belong to a git repository with a recognized git remote.
     */
    url?: string;
}

// This plugin adds a property to reflections, use declaration merging to type it correctly.
declare module '../../models/reflections/abstract' {
    export interface Reflection {
        /**
         * A list of all source files that contributed to this reflection.
         * This is added by the {@link SourcePlugin}.
         */
        sources?: SourceReference[];
    }
}

// We also add data to the serialized JSON, so merge that in as well. Since nothing special is done,
// we can use the same interface.
declare module '../../serialization/schema' {
    export interface SerializedReflection<T extends SomeReflection> {
        sources?: SourceReference[];
    }
}

// Plugins specify a `load` function which will be called by TypeDoc to enable setting up event listeners.
export function load(app: Application) {
    // 3rd party plugins should add options to app here.
    // app.options.addDeclaration(...)

    shell.config.silent = true;
    let resolver: HostLinkResolver;

    // At this point options haven't all been set, so wait to check them until we've started conversion.
    app.converter.on('begin', () => {
        if (!shell.which('git')) { return; }
        if (app.options.getValue('disableSources')) { return; }

        resolver = new HostLinkResolver(app.options.getValue('gitRemote'), app.options.getValue('gitRevision'));

        app.converter.on('reflectionCreated', (reflection, _, nodes) => {
            reflection.sources = nodes.map(getSourceReference);
        });

        app.serializer.addReflectionSerializer(ReflectionKind.All, {
            order: 100,
            serialize(reflection, data) {
                return {
                    ...data,
                    sources: reflection.sources?.map(ref => ({ ...ref }))
                };
            }
        });
    });

    function getSourceReference(node: ts.Node & { name?: { end?: number }}): SourceReference {
        let position: ts.LineAndCharacter;
        if (node.name && node.name.end) {
            position = ts.getLineAndCharacterOfPosition(node.getSourceFile(), node.name.end);
        } else {
            position = ts.getLineAndCharacterOfPosition(node.getSourceFile(), node.pos);
        }
        // TODO: Relative to rootDir
        const fileName = node.getSourceFile().fileName;

        return {
            fileName,
            line: position.line + 1,
            character: position.character,
            url: resolver.tryGetUrl(fileName, position.line + 1)
        };
    }
}