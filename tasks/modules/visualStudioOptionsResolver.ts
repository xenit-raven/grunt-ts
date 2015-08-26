'use strict';

import * as csproj2ts from 'csproj2ts';
import * as path from 'path';
import * as utils from './utils';
import {Promise} from 'es6-promise';
import * as _ from 'lodash';

export function resolveVSOptionsAsync(applyTo: IGruntTSOptions,
  taskOptions: ITargetOptions,
  targetOptions: ITargetOptions) {

  return new Promise<IGruntTSOptions>((resolve, reject) => {

    {
      const vsTask: IVisualStudioProjectSupport = getVSSettings(taskOptions),
            vsTarget: IVisualStudioProjectSupport = getVSSettings(targetOptions);
      let vs: IVisualStudioProjectSupport = null;

      if (vsTask) {
          vs = vsTask;
      }
      if (vsTarget) {
          if (!vs) {
              vs = vsTarget;
          }
          if (vsTarget.project) {
              vs.project = vsTarget.project;
          }
          if (vsTarget.config) {
              vs.config = vsTarget.config;
          }
          if (vsTarget.ignoreFiles) {
              vs.ignoreFiles = vsTarget.ignoreFiles;
          }
          if (vsTarget.ignoreSettings) {
              vs.ignoreSettings = vsTarget.ignoreSettings;
          }
      }
      if (vs) {
        applyTo.vs = vs;
      }
    }

    if (applyTo.vs) {
        csproj2ts.getTypeScriptSettings({
            ProjectFileName: (<IVisualStudioProjectSupport>applyTo.vs).project,
            ActiveConfiguration: (<IVisualStudioProjectSupport>applyTo.vs).config || undefined
        }).then((vsConfig) => {

          applyTo = applyVSOptions(applyTo, vsConfig);
          applyTo = resolve_out_and_outDir(applyTo, taskOptions, targetOptions);
          resolve(applyTo);
          return;
        }).catch((error) => {
            if (error.errno === 34) {
                applyTo.errors.push('In target "' + applyTo.targetName + '" - could not find VS project at "' + error.path + '".');
            } else {
                applyTo.errors.push('In target "' + applyTo.targetName + '".  Error #' + error.errno + '.  ' + error);
            }
            reject(error);
            return;
        });
        return;
    }
    resolve(applyTo);
  });
}

function resolve_out_and_outDir(options: IGruntTSOptions, taskOptions: IGruntTargetOptions,
    targetOptions: IGruntTargetOptions) {
  if (options.CompilationTasks && options.CompilationTasks.length > 0) {
    options.CompilationTasks.forEach((compilationTask) => {
      [taskOptions, targetOptions].forEach(optionSet => {
          if (optionSet && optionSet.out) {
            compilationTask.out = optionSet.out;
          }
          if (optionSet && optionSet.outDir) {
            compilationTask.outDir = optionSet.outDir;
          }
      });
    });
  }
  return options;
}


function applyVSOptions(options: IGruntTSOptions, vsSettings: csproj2ts.TypeScriptSettings) {
  let ignoreFiles = false, ignoreSettings = false;

  if (typeof options.vs !== 'string') {
    let vsOptions : IVisualStudioProjectSupport = <IVisualStudioProjectSupport>options.vs;
    ignoreFiles = !!vsOptions.ignoreFiles;
    ignoreSettings = !!vsOptions.ignoreSettings;
  }

  if (!ignoreFiles) {

      if (options.CompilationTasks.length === 0) {
        options.CompilationTasks.push({src: []});
      }

      let src = options.CompilationTasks[0].src;
      let absolutePathToVSProjectFolder = path.resolve(vsSettings.VSProjectDetails.ProjectFileName, '..');

      const gruntfileFolder = path.resolve('.');
      _.map(_.uniq(vsSettings.files), (file) => {
          const absolutePathToFile = path.normalize(path.join(absolutePathToVSProjectFolder, file));
          const relativePathToFileFromGruntfile = path.relative(gruntfileFolder, absolutePathToFile).replace(new RegExp('\\' + path.sep, 'g'), '/');

          if (src.indexOf(absolutePathToFile) === -1 &&
              src.indexOf(relativePathToFileFromGruntfile) === -1) {
              src.push(relativePathToFileFromGruntfile);
          }
      });
  }

  if (!ignoreSettings) {
    options = applyVSSettings(options, vsSettings);
  }

  return options;
}

function relativePathToVSProjectFolderFromGruntfile(settings: csproj2ts.TypeScriptSettings) {
  return path.resolve(settings.VSProjectDetails.ProjectFileName, '..');
}

function applyVSSettings(options: IGruntTSOptions, vsSettings: csproj2ts.TypeScriptSettings) {

  // TODO: support TypeScript 1.5 VS options.
  const simpleVSSettingsToGruntTSMappings = {
    'GeneratesDeclarations': 'declaration',
    'NoEmitOnError': 'noEmitOnError',
    'MapRoot': 'mapRoot',
    'NoImplicitAny': 'noImplicitAny',
    'NoResolve': 'noResolve',
    'PreserveConstEnums': 'preserveConstEnums',
    'RemoveComments': 'removeComments',
    'SourceMap': 'sourceMap',
    'SourceRoot': 'sourceRoot',
    'SuppressImplicitAnyIndexErrors': 'suppressImplicitAnyIndexErrors',
    'Target': 'target'
  };

  for (let item in simpleVSSettingsToGruntTSMappings) {
    if (!(simpleVSSettingsToGruntTSMappings[item] in options) && utils.hasValue(vsSettings[item])) {
        options[simpleVSSettingsToGruntTSMappings[item]] = vsSettings[item];
    }
  }

  if (!('module' in options) && utils.hasValue(vsSettings.ModuleKind)) {
      options.module = vsSettings.ModuleKind;
      if (options.module === 'none') {
          options.module = undefined;
      }
  }

  const gruntfileToProject = relativePathToVSProjectFolderFromGruntfile(vsSettings);

  if (utils.hasValue(vsSettings.OutDir) && vsSettings.OutDir !== '') {
      options.CompilationTasks.forEach((item) => {
      let absolutePath = path.resolve(gruntfileToProject, vsSettings.OutDir);
      item.outDir = utils.escapePathIfRequired(
        path.relative(path.resolve('.'), absolutePath).replace(new RegExp('\\' + path.sep, 'g'), '/')
      );
    });
  }

  if (utils.hasValue(vsSettings.OutFile) && vsSettings.OutFile !== '') {
    options.CompilationTasks.forEach((item) => {
      let absolutePath = path.resolve(gruntfileToProject, vsSettings.OutFile);
      item.out = utils.escapePathIfRequired(
        path.relative(path.resolve('.'), absolutePath).replace(new RegExp('\\' + path.sep, 'g'), '/')
      );
    });
  }

  return options;
}

function getVSSettings(rawTargetOptions: ITargetOptions) {
    let vs: IVisualStudioProjectSupport = null;
    if (rawTargetOptions && rawTargetOptions.vs) {
        var targetvs = rawTargetOptions.vs;
        if (typeof targetvs === 'string') {
            vs = {
                project: targetvs,
                config: '',
                ignoreFiles: false,
                ignoreSettings: false
            };
        } else {
            vs = {
                project: targetvs.project || '',
                config: targetvs.config || '',
                ignoreFiles: targetvs.ignoreFiles || false,
                ignoreSettings: targetvs.ignoreSettings || false
            };
        }
    }
    return vs;
}