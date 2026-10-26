// Settings for `pnpm studio`. The renderer script passes the same override.
import { Config } from '@remotion/cli/config';

import { automaticJsx } from './src/remotion/webpack-override';

Config.overrideWebpackConfig(automaticJsx);
